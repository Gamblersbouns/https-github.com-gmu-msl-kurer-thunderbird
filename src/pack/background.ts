/**
 * This is the entry-point for the Thunderbird plugin API made available as a background script for Kurer.
 * This is compiled by webpack (`npm run build`) into `scripts/background_bundled.js` which is loaded via the main manifest.
 */
import * as Common from "./common";

/** Up to date copy of currently set options */
let options: Options = null
fetchOptionsOnStartup()

/** Open communication ports among foreground scripts, mostly to stream updates to options and logs */
let ports: browser.runtime.Port[] = []

browser.runtime.onConnect.addListener(port=>{
    ports.push(port)
    port.onMessage.addListener((msg:Message)=>{
        if (msg.type=="getOptions") {
            let msg:Message = {
                type: "sendOptions",
                payload: options
            } 
            port.postMessage(msg)
        } 
        else if (msg.type=="log") console.log(msg.payload)
        else if (msg.type=="dir") console.dir(msg.payload)
    })
    port.onDisconnect.addListener(p=> ports = ports.filter(item => item !== p) )
})

const defaultOptions: Options = {
    options: {
        autoEncrypt:true, autoSign:true, warningUnsecure:true
    }
}

async function fetchOptionsOnStartup() {
    options = await browser.storage.local.get("options")
    if (!options) await browser.storage.local.set(defaultOptions)
    options = defaultOptions
    console.log("background got options first time")
}

document.addEventListener("DOMContentLoaded",registerScripts)

/** Register notification bar script injection to compose and display pages */
async function registerScripts() {
    try {
        await messenger.composeScripts.register({
        css: [ {file: "css/notification-bar.css" }],
        js: [ {file: "/scripts/notifBar.js"} ]
        })
        
        await messenger.messageDisplayScripts.register({
            css: [ {file: "css/notification-bar.css" }],
            js: [ {file: "/scripts/notifBar.js"} ]
        })
    } catch (e) {console.error(e)}
}


// update running copy of options if it is changed
browser.storage.onChanged.addListener(changes=>{
    if (!changes.options) return // if options were unchanged, don't care
    Object.assign(options.options,changes.options.newValue)
    console.log("background updated options")
    // communicate the changes in options
    ports.forEach(port => {
        let msg:Message = {
            type: "sendOptions",
            payload: options
        }
        port.postMessage(msg)
    })
    
})

/** Strips the extra html created by our notification bar logic to return the original body and returns the html content of the document body */
function stripNotificationBar(body:string): string {
    let doc = new DOMParser().parseFromString(body,'text/html')
    let notifbar = doc.querySelector("div.nBarOuter")
    if (notifbar) notifbar.remove()
    return doc.querySelector("body").innerHTML
}

browser.runtime.onMessage.addListener((data: Message)=>{
    if ( data.type=="encrypt" || data.type=="sign" ) {
        let func = data.type=="encrypt" ? encrypt : sign
        browser.windows.getAll({populate:true})
        .then((w)=>{ func(w.find(w=>w.type=="messageCompose"as any&&w.focused).tabs[0].id,null,true) })
    }

    if (data.type=="decrypt") {
        return Common.smimeDecrypt(data.ciphertext, options.options.privateKey)
    }
})
/** Clean up the message before sending (remove any possible notification bars) */
messenger.compose.onBeforeSend.addListener( onBeforeSendEncrSign )
/** Event listener for when a composed message is about to be sent */
async function onBeforeSendEncrSign(tab, dets) {
    if (!options) return
    let cancel = false 
    let finalDets = { body: stripNotificationBar(dets.body) }

    if (options.options.autoSign) { // do auto sign
        console.log("auto signing!")
        let newDets = await sign(tab.id, finalDets.body)
        if (!newDets) {
            console.error("Failed sign, halting send")
            cancel = true // cancel send if the warning option is set
        } else {
            finalDets.body = newDets.body
        }
    }

    if (!cancel && options.options.autoEncrypt) { // do auto encrypt
        console.log("auto encrypting!")
        let newDets = await encrypt(tab.id, finalDets.body)
        if (!newDets) {
            console.error("Failed encryption, halting send if needed")
            cancel = options.options.warningUnsecure // cancel send if the warning option is set
        } else {
            finalDets.body = newDets.body
        }
    }

    return {cancel: cancel, details: finalDets}
}
/** Always set to the message most recently opened message */
let currentlyViewedMessageId = null

messenger.messageDisplay.onMessageDisplayed.addListener( onDisplayDcrpVeri )
/** Try and print out html message body part of displayed message*/
async function onDisplayDcrpVeri(tab:browser.tabs.Tab, msg:messenger.messages.MessageHeader) {
    const hPlaintext = "text/plain"; const hHTML = "text/html"
    currentlyViewedMessageId = msg.id
    let msgPart = await messenger.messages.getFull(msg.id)
    // do a depth first search for desired mime part by header (text or html)
    function searchParts(part:messenger.messages.MessagePart, contentTypeToMatch:string): messenger.messages.MessagePart {
        if (part.contentType == contentTypeToMatch) return part
        else if (part.parts) {
            for (let i=0; i<part.parts.length; i++) {
                let found = searchParts(part.parts[i], contentTypeToMatch)
                if (found) return found
            }
            return null
        }
    }
    console.log(msgPart)
    // get cannonical sender's address
    let sender = msgPart.headers.from[0] as string
    if (!sender) return
    if (sender.slice(-1)=='>') { // if the from header has angle brackets at the end, we extract email from within
        let i = sender.lastIndexOf('<')
        if (i!=-1) sender = sender.slice(i+1,-1)
    }
    console.log(`email from: '${sender}'`)
    // try and get html part
    let htmlVersion = true
    let found = searchParts(msgPart, hHTML)
    if (!found) { // compatability if the message was sent with plaintext
        found = searchParts(msgPart, hPlaintext)
        htmlVersion = false
    }
    let body = htmlVersion? found.body: `<body><pre>${found.body}</pre></body>`
    // parse html email as DOM
    let doc = new DOMParser().parseFromString(body,'text/html')
    // attempt to find a pre block with encrypted or signed SMIME content
    let block = doc.querySelector("pre")
    if (
        !block ||
        !block.innerText.startsWith("Content-Type: application/pkcs7-mime") &&
        !block.innerText.startsWith("Content-Type: multipart/signed")
    ) return  
        
    let connected = await awaitScriptOnTab(tab.id)
    if (!connected) {
        console.log(`Abort decryption with content script on tab#${tab.id}`)
        return
    }
    if (msg.id != currentlyViewedMessageId) return
    await browser.tabs.sendMessage(tab.id,{type:"notif",payload:["Decrypting and Verifying SMIME message"]})
    let time = performance.now()
    
    
    let decrypted: {success:boolean,msg}[] = [] , verified: {success:boolean,msg}[] = []
    while (true) {
        let block = doc.querySelector("pre")
        if (!block) break
        if (block.innerText.startsWith("Content-Type: application/pkcs7-mime")) {
            decrypted.push(await decrypt(block))
            // if last decryption was not successful, do not process any further
            if (!decrypted[decrypted.length-1].success) break
            continue
        }
        if (block.innerText.startsWith("Content-Type: multipart/signed")) {
            verified.push(await verify(block, sender))
            // if last decryption was not successful, do not process any further
            if (!verified[verified.length-1].success) break
            continue
        }
        else break
    }
    let duration = performance.now() - time
    const requiredDuration = 1000
    if (duration < requiredDuration) {
        await new Promise(r => setTimeout(r, requiredDuration - duration)); // minimum processing time for security
    }
    if (msg.id != currentlyViewedMessageId) return
    await browser.tabs.sendMessage(tab.id,{type:"replace", payload:doc.querySelector("body").innerHTML})
    let finalNotifs = []
    if (decrypted.length>0) finalNotifs.push(decrypted[decrypted.length-1].msg)
    if (verified.length>0) finalNotifs.push(verified[verified.length-1].msg)
    else finalNotifs.push(`<span class="color-neg">Message not signed by sender</span>`)
    if (msg.id != currentlyViewedMessageId) return
    await browser.tabs.sendMessage(tab.id,{type:"notif",payload:finalNotifs.flat()})

}
/** Blocks thread until sucessful ping to content script on a tab - returns true if successful */
async function awaitScriptOnTab(tabId:number,repeat?:number,interval?:number): Promise<boolean> {
    if (!repeat) repeat = 8
    if (!interval) interval = 250
    let found = false, i = 0
    while (!found && i<repeat) {
        try {
            let response = await browser.tabs.sendMessage(tabId,{type: "ping"} as Message)
            console.log(`Ping success to tab#${tabId}: "${response}"`)
            found = true
        } catch (e) {
            console.log(`Failed ping to tab#${tabId} - #${i}`,e)
            await new Promise(r => setTimeout(r, interval));
            i++
        }
    }
    return found
}
/** Attempt to decrypt given html pre block containing smime encrypted text */
async function decrypt(block:HTMLPreElement): Promise<{success:boolean,msg:string[]}> {
    if (!options.options || !options.options.privateKey) {
        return {
            success: false,
            msg: [
                `<span class="color-neg">SMIME Decryption Failed</span>`,
                `<span class="font-sub"><i>Private Key</i> must be configured in settings</span>`
            ]
        }
    }
    try {
        let decryptedBlock = await Common.smimeDecrypt(block.innerText,options.options.privateKey)
        block.outerHTML = decryptedBlock
        return {
            success: true,
            msg: [`<span class="color-pos">SMIME Message Decrypted</span>`,`<span class="font-sub">This email was for your eyes only</span>`]
        }
    } catch (e) {
        return {
            success: false,
            msg: [`<span class="color-neg">SMIME Decryption Error</span>`,`<pre class="font-sub">${e}</pre>`]
        }
    }
}

async function verify(block:HTMLPreElement, sender:string): Promise<{success:boolean,msg:string[]}> {
    try {
        let cert
        try {
            cert = await getCertFromDANE(sender)
        } catch (e) {
            return {
                success: false,
                msg: [
                    `<span class="color-neg">Signature unverified</span>`,
                    `<span class="font-sub">Unable to find <i>${sender}</i> certificate over DANE</span>`,
                    `<pre class="font-sub">${e}</pre>`
                ]
            }
        } 
        let verified = await Common.smimeVerify(block.innerText,cert)
        block.outerHTML = await Common.smimeGetSignatureBody(block.innerText)
        return {
            success: verified,
            msg: [
                verified?`<span class="color-pos">Signature Verified</span>`
                :`<span class="color-neg">Signature Unverified</span>`,
                verified?`<span class="font-sub">From <i>${sender}</i></span>`
                :`<span class="font-sub">Email does not match signiture!</span>`
            ]
        }

    } catch (e) {
        return {
            success: false,
            msg: [
                `<span class="color-neg">Signature unverified</span>`,
                `<pre class="font-sub">${e}</pre>`
            ]
        }
    }
}

/** 
 * Given the tab ID of a composition pane, will replace the body with encrypted text 
 *  @returns the updated details object, or null on error (will generate correct error messsaging on screen) 
 */
async function encrypt(tabId:number, overrideBody?:string): Promise<{body:string}> {
    let composeDets = await messenger.compose.getComposeDetails(tabId)
    if (composeDets.to.length<1) {
        browser.tabs.sendMessage(tabId,{type:"notif",payload:["Please enter one recipient"]} as Message)
        return null
    }
    if (composeDets.to.length>1) {
        browser.tabs.sendMessage(tabId,{type:"notif",payload:["Currently cannot handle more than one recipient at a time"]} as Message)
        return null
    }
    // start by searching the cache
    let recipient = null
    if (options.options.cache) recipient = options.options.cache.find(item=>{item.name == composeDets.to[0].toString()})
    let recipientCert = null
    if (recipient) recipientCert = recipient.cert
    if (!recipientCert) {
        browser.tabs.sendMessage(tabId,{type:"notif",payload:["Cache miss, conducting DANE query..."]})
        let cfSMIMEA = await Common.DNSGetSMIMEA(composeDets.to[0].toString())
        if (!cfSMIMEA) {
            browser.tabs.sendMessage(tabId,{type:"notif",payload:["Target record not found..."]})
            return null
        }
        if (cfSMIMEA.Authority && cfSMIMEA.Authority[0].type !== 53) {
            // not the authority for S/MIMEA records
            browser.tabs.sendMessage(tabId,{type:"notif",payload:["Target record not found...","Authority mismatch"]})
            return null
        }
        // SMIMEA record found
        if (cfSMIMEA.Answer && cfSMIMEA.Answer[0].type === 53) {
            // Extract data from record
            const SMIMEARecord = Common.CloudflareSMIMEARecordToSMIMEARecord(cfSMIMEA.Answer[0].data);
            recipientCert = Common.PEMencode(SMIMEARecord.binaryCertificate, "certificate");
            browser.tabs.sendMessage(tabId,{type:"notif",payload:["Certificate found, encrypting..."]})
        }
        else {
            let answer = JSON.stringify(cfSMIMEA.Answer,null,2)
            browser.tabs.sendMessage(tabId,{type:"notif",payload:["Target record not found...","Other",`<pre style="font-size:xxx-small">${answer}<pre>`]})
            return null
        }
    }
    let encryptedBody
    try {
        let body = overrideBody? overrideBody: composeDets.body
        try { body = stripNotificationBar(body) } 
        catch (e) { browser.tabs.sendMessage(tabId,{type:"notif",payload:["Compose body HTML stripping error...",`<pre>${e}</pre>`]}); return null }
        // encrypt body
        encryptedBody = await Common.smimeEncrypt(body,recipientCert)
    } catch(e) {
        console.log("Encryption error", e)
        browser.tabs.sendMessage(tabId,{type:"notif",payload:["Encryption error...",`<pre>${e}</pre>`]})
        return null
    }
    /** Value to return - object containing the updated body of the mail before sending */
    let detUpdate
    try {
        detUpdate = { body: `<pre>${encryptedBody}</pre>` }
        messenger.compose.setComposeDetails(tabId,detUpdate)
        // send update notif with a delay, to allow compose details to update first
        browser.tabs.sendMessage(tabId,{type:"notif", delay:500, payload:["Encryption complete",`To: <span class="color-green">${composeDets.to[0]}</span>`]})
    } catch (e) {
        browser.tabs.sendMessage(tabId,{type:"notif",payload:["Composition error...",`<pre>${e}</pre>`]})
        return null
    }
    
    return detUpdate
}
/** 
 * Attempts to sign the given compose window content, 
 * setting and returning updated details.
 * @param tabId ID of compose message tab to sign content of
 * @param overrideBody If defined, use this instead of reading the body of the message 
 * @returns null on failed sign. 
 * */
async function sign(tabId:number, overrideBody?:string, showEndNotif?:boolean): Promise<{body:string}> {
    let composeDets = await messenger.compose.getComposeDetails(tabId)
    try {
        if (!options) throw new Error("Options not configured")
        if (!options.options.email) throw new Error("Sender email not configured")
        let cert: string = null
        if (options.options.cert) cert = options.options.cert
        if (!cert) cert = await getCertFromDANE(options.options.email)
        console.log("SIGN: GOT CERT",cert)

        let body = overrideBody? overrideBody: composeDets.body
        try { body = stripNotificationBar(body) } 
        catch (e) { console.log(e); browser.tabs.sendMessage(tabId,{type:"notif",payload:["Compose body HTML stripping error...",`<pre>${e}</pre>`]}); return null }
        console.log("SIGN: BODY",body)
        if (!options.options.privateKey || options.options.privateKey.length==0) throw new Error("Your signing key must be set in options")
        body = await Common.smimeSign(body,options.options.privateKey,cert)
        
        let detUpdate
        try {
            detUpdate = { body: `<pre>${body}</pre>` }
            messenger.compose.setComposeDetails(tabId,detUpdate)
            // send update notif with a delay, to allow compose details to update first
            if (showEndNotif) browser.tabs.sendMessage(tabId,{type:"notif", delay:500, payload:["Signing complete",`By: <span class="color-green">${options.options.email}</span>`]})
        } catch (e) {
            browser.tabs.sendMessage(tabId,{type:"notif",payload:["Composition error...",`<pre>${e}</pre>`]})
            return null
        }
    
        return detUpdate
    } catch (e) {
        console.log("Signing error", e)
        browser.tabs.sendMessage(tabId,{type:"notif", delay:500, payload:["Signing error", `<pre>${e}</pre>`]})
        return null
    }
}
/** Returns certificate pem string from dane query. Will reject if failed with reason. */
async function getCertFromDANE(email): Promise<string> {
    let response = await Common.DNSGetSMIMEA(email)
    if (!response) {
        throw new Error("Target record not found...")
    }
    if (response.Authority && response.Authority[0].type !== 53) {
        // not the authority for S/MIMEA records
        throw new Error("Target record not found, authority mismatch")
    }
    // SMIMEA record found
    if (response.Answer && response.Answer[0].type === 53) {
        // Extract data from record
        const SMIMEARecord = Common.CloudflareSMIMEARecordToSMIMEARecord(response.Answer[0].data);
        return Common.PEMencode(SMIMEARecord.binaryCertificate, "certificate");
    }
    else {
        throw new Error("Target record not found...")
    }
}

console.log("Background script finished loading 123!")