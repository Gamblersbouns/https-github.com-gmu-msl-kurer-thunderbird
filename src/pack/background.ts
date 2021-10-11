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
        else if (msg.type=="log") {
            if (Common.VERBOSE_LOGS) console.log(msg.payload)
        }
        else if (msg.type=="dir") {
            if (Common.VERBOSE_LOGS) console.dir(msg.payload)
        } else if (msg.type=='get') { // handle get-type messages
            if (msg.query=="composeSign") {
                composeGetSigned( msg.tabId )
                .then( signed => { port.postMessage({ type:'reply', query:'composeSign', signed:signed } as Message) })  
            } else if (msg.query=="composeTabId") {
                browser.windows.getAll({ populate:true })
                .then(w=>{ 
                    let tab = w.find(w=>w.type=="messageCompose"as string&&w.focused).tabs[0] 
                    if (tab) { port.postMessage({ type:'reply', query:'composeTabId', tabId:tab.id} as Message) }
                })
            } 
        } else if (msg.type=="action") { // handle action-type messages
            console.dir(msg)
            if (msg.action=="composeSetSigned") { // simply modify the signed badge to the correct state
                messenger.composeAction.setBadgeBackgroundColor({
                    color: msg.signed ? COLOR_SIGN : COLOR_NOT_SIGN,
                    tabId: msg.tabId
                })
            } else if (msg.action=="composeSendEncrypt") { // send the message encrypted
                encryptFlag = true
                messenger.compose.sendMessage(msg.tabId, {mode:"sendNow"})
                .catch(e=>{console.error(e)})
            }
        }
    })
    port.onDisconnect.addListener(p=> ports = ports.filter(item => item !== p) )
})

const defaultOptions: Options = {
    options: {
        autoEncrypt:false, autoSign:true, warningUnsecure:true
    }
}

async function fetchOptionsOnStartup() {
    options = await browser.storage.local.get("options")
    if (!options) {
        await browser.storage.local.set(defaultOptions)
        options = defaultOptions
    }
    if (Common.VERBOSE_LOGS) if (Common.VERBOSE_LOGS) console.log("background got options first time")
    initSignBadge()
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
    } catch (e) {if (Common.VERBOSE_LOGS) if (Common.VERBOSE_LOGS) console.error(e)}
}

/** Returns true if the compose tab given by id is set to be signed  */
async function composeGetSigned(tabId:number): Promise<boolean> {
    let color = await messenger.composeAction.getBadgeBackgroundColor({ tabId: tabId })
    let toRet = color && rgbToHex(color).toLocaleLowerCase()==COLOR_SIGN
    if (Common.VERBOSE_LOGS) console.log("COMPOSE GET SIGNED FOR TAB "+tabId+" is "+toRet)
    return toRet
}
// update running copy of options if it is changed
browser.storage.onChanged.addListener(changes=>{
    if (!changes.options) return // if options were unchanged, don't care
    Object.assign(options.options,changes.options.newValue)
    if (Common.VERBOSE_LOGS) if (Common.VERBOSE_LOGS) console.log("background updated options")
    // communicate the changes in options
    ports.forEach(port => {
        let msg:Message = {
            type: "sendOptions",
            payload: options
        }
        port.postMessage(msg)
    })
    // reinitialize the compose action with new options
    initSignBadge()
    
})
/** Converts rgba.. array to rgb hex string */
function rgbToHex(c: number[]) {
    let toHex = (n:number)=>{let h=n.toString(16); return h.length==1 ? "0"+h : h}
    return '#' + toHex(c[0]) + toHex(c[1]) + toHex(c[2]) 
}
/** Badge color when sign is disabled */
const COLOR_NOT_SIGN = "#b71c1c"
/** Badge color when sign is enabled */
const COLOR_SIGN = "#2e7d32"
const SIGN_TEXT = "SIG"
/** Sets the compose action badge globally acording to onSign option */
function initSignBadge() {
    if (Common.VERBOSE_LOGS) console.log("INIT SIGN BADGE")
    if (options && options.options && options.options.autoSign) {
        let sign = options.options.autoSign
        messenger.composeAction.setBadgeBackgroundColor({ color: sign?COLOR_SIGN:COLOR_NOT_SIGN })
        messenger.composeAction.setBadgeText({ text: SIGN_TEXT })
    }
}
/** Strips the extra html created by our notification bar logic to return the original body and returns the html content of the document body */
function stripNotificationBar(body:string): string {
    let doc = new DOMParser().parseFromString(body,'text/html')
    let notifbar = doc.querySelector("div.nBarOuter")
    if (notifbar) notifbar.remove()
    return doc.querySelector("body").innerHTML
}
/** Recieve requests to manually sign or encrypt the body on the compose window currently opened and focused*/
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
/** This flag is raised if the composed message needs to be encrypted on sending. It is always lowered after a send */
let encryptFlag = false
/** Event listener for when a composed message is about to be sent */
async function onBeforeSendEncrSign(tab, dets) {
    console.log("Starting onBeforeSend Handler")
    if (!options) return
    let cancel = false 
    let finalDets = { body: stripNotificationBar(dets.body) }

    if (await composeGetSigned(tab.id)) { // do signed
        if (Common.VERBOSE_LOGS) if (Common.VERBOSE_LOGS) console.log("auto signing!")
        let newDets = await sign(tab.id, finalDets.body)
        if (!newDets) {
            if (Common.VERBOSE_LOGS) if (Common.VERBOSE_LOGS) console.error("Failed sign, halting send")
            cancel = true // cancel send if the warning option is set
        } else {
            finalDets.body = newDets.body
        }
    }
    if (options.options && options.options.autoEncrypt) encryptFlag = true
    if (!cancel && encryptFlag) { // do auto encrypt
        if (Common.VERBOSE_LOGS) if (Common.VERBOSE_LOGS) console.log("auto encrypting!")
        let newDets = await encrypt(tab.id, finalDets.body)
        if (!newDets) {
            if (Common.VERBOSE_LOGS) if (Common.VERBOSE_LOGS) console.error("Failed encryption, halting send if needed")
            cancel = options.options.warningUnsecure // cancel send if the warning option is set
        } else {
            finalDets.body = newDets.body
        }
    }
    encryptFlag = false
    return {cancel: cancel, details: finalDets}
}
/** Extracts actual aaa@bbb.com email address from MIME header style addresses */
function getEmailFromRecipient(recipient:string): string {
    if (recipient.slice(-1)=='>') { // if the from header has angle brackets at the end, we extract email from within
        let i = recipient.lastIndexOf('<')
        if (i!=-1) recipient = recipient.slice(i+1,-1)
    }
    return recipient
}
/** Always set to the message most recently opened message */
let currentlyViewedMessageId = null

messenger.messageDisplay.onMessageDisplayed.addListener( onDisplayDcrpVeri )
/** Try and print out html message body part of displayed message*/
async function onDisplayDcrpVeri(tab:browser.tabs.Tab, msg:messenger.messages.MessageHeader) {
    
    const hPlaintext = "text/plain"; const hHTML = "text/html"
    currentlyViewedMessageId = msg.id
    let msgPart = await messenger.messages.getFull(msg.id)
    if (Common.VERBOSE_LOGS) if (Common.VERBOSE_LOGS) console.dir(msgPart)
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
    // get cannonical sender's address
    let sender = msgPart.headers.from[0] as string
    if (!sender) return
    sender = getEmailFromRecipient(sender)
    // try and get html part
    let htmlVersion = true
    let found = searchParts(msgPart, hHTML)
    if (!found) { // compatability if the message was sent with plaintext
        found = searchParts(msgPart, hPlaintext)
        htmlVersion = false
    }
    /** The workable string representation of the html message body */
    let body
    if (htmlVersion) {
        body = found.body
    } else {
        body = Common.htmlEncode(found.body)
        body = `<pre>${body}</pre>`
    }
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
        if (Common.VERBOSE_LOGS) if (Common.VERBOSE_LOGS) console.log(`Abort decryption with content script on tab#${tab.id}`)
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
    const requiredDuration = 800
    if (duration < requiredDuration) {
        await new Promise(r => setTimeout(r, requiredDuration - duration)); // minimum processing time for security
    }
    if (msg.id != currentlyViewedMessageId) return
    let finalNotifs = []
    if (decrypted.length>0) finalNotifs.push(decrypted[decrypted.length-1].msg)
    if (verified.length>0) finalNotifs.push(verified[verified.length-1].msg)
    else finalNotifs.push(`<span class="color-mid">Message not signed by sender</span>`)
    await browser.tabs.sendMessage(tab.id,{type:"replace", payload:doc.querySelector("body").innerHTML})
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
            if (Common.VERBOSE_LOGS) if (Common.VERBOSE_LOGS) console.log(`Ping success to tab#${tabId}: "${response}"`)
            found = true
        } catch (e) {
            if (Common.VERBOSE_LOGS) if (Common.VERBOSE_LOGS) console.log(`Failed ping to tab#${tabId} - #${i}`,e)
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
        const USE_TEST_CERT_INSTEAD_OF_DANE = false
        let cert
        if (USE_TEST_CERT_INSTEAD_OF_DANE) cert = testCert
        try {
            if (!cert) cert = await getCertFromDANE(sender)
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
        // we must redicode the inside of the pre tags in order to pass verification
        const decodedContent = Common.htmlDecode(block.innerHTML)
        let verified = (await Common.smimeVerify(decodedContent,cert)).signatureVerified
        block.outerHTML = await Common.smimeGetSignatureBody(decodedContent)
        return {
            success: verified,
            msg: [
                verified?`<span class="color-pos">Signature Verified</span>`
                :`<span class="color-neg">Signature Unverified</span>`,
                verified?`<span class="font-sub">From <i>${sender}</i></span>`
                :`<span class="font-sub">Mail does not match signiture!</span>`
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
    let encryptedBody:string
    try {
        let body = overrideBody? overrideBody: composeDets.body
        try { body = stripNotificationBar(body) } 
        catch (e) { browser.tabs.sendMessage(tabId,{type:"notif",payload:["Compose body HTML stripping error...",`<pre>${e}</pre>`]}); return null }
        // encrypt body
        encryptedBody = await Common.smimeEncrypt(body,recipientCert)
    } catch(e) {
        if (Common.VERBOSE_LOGS) if (Common.VERBOSE_LOGS) console.log("Encryption error", e)
        browser.tabs.sendMessage(tabId,{type:"notif",payload:["Encryption error...",`<pre>${e}</pre>`]})
        return null
    }
    /** Value to return - object containing the updated body of the mail before sending */
    let detUpdate
    try {
        // encode encrypted body into pre tags
        let finalBody = Common.htmlEncode(encryptedBody) 
        finalBody = `<pre>${finalBody}</pre>`
        detUpdate = { body: finalBody}
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
        //if (Common.VERBOSE_LOGS) if (Common.VERBOSE_LOGS) console.log("SIGN: GOT CERT",cert)

        let body = overrideBody? overrideBody: composeDets.body
        try { body = stripNotificationBar(body) } 
        catch (e) { if (Common.VERBOSE_LOGS) if (Common.VERBOSE_LOGS) console.log(e); browser.tabs.sendMessage(tabId,{type:"notif",payload:["Compose body HTML stripping error...",`<pre>${e}</pre>`]}); return null }
        //if (Common.VERBOSE_LOGS) if (Common.VERBOSE_LOGS) console.log("SIGN: BODY",body)
        if (!options.options.privateKey || options.options.privateKey.length==0) throw new Error("Your signing key must be set in options")
        // make sure to sign HTML decoded version of body
        let decodedBody = Common.htmlDecode(body) 
        body = await Common.smimeSign(decodedBody,options.options.privateKey,cert)
        
        let detUpdate
        try {
            // re encode the whole thing before putting it in pre tags
            let finalBody = Common.htmlEncode(body) 
            finalBody = `<pre>${finalBody}</pre>`
            detUpdate = { body: finalBody}
            messenger.compose.setComposeDetails(tabId,detUpdate)
            // send update notif with a delay, to allow compose details to update first
            if (showEndNotif) browser.tabs.sendMessage(tabId,{type:"notif", delay:500, payload:["Signing complete",`By: <span class="color-green">${options.options.email}</span>`]})
        } catch (e) {
            browser.tabs.sendMessage(tabId,{type:"notif",payload:["Composition error...",`<pre>${e}</pre>`]})
            return null
        }
    
        return detUpdate
    } catch (e) {
        if (Common.VERBOSE_LOGS) if (Common.VERBOSE_LOGS) console.log("Signing error", e)
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




const testKey =
`
-----BEGIN PRIVATE KEY-----
MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQCPYZQ4xTb7pyov
N+5oGVNVLjZ+UuQYWCbWR/DCAbWtKiHxUqeR1r9OzWF6n70VUbrGsf3EshirapD4
4quIFKQblsoyG0iE4Mg4END9yMhjzaXB+wvR5jHAsYPfquF3nbs8Bw7wmZgYQX9N
wW45kvF1jwWVrQCnofLJLZBskKrgzfZEmWYxZ6Y2slvCBIP/ScoSPQ2dtvK8ZV1T
lFlFmJ6AeuFYGi46Us9MTUG8by3VG80YuJlZG69GIWrwWhUGBx47DNVYtkmP3V5V
+OZFGHQROiA15ADzvaSefUmGlcRpNqQD8Gj0jxgk2W2qCcIkd0PHFYr4vkYHB7K/
ZET15hlTAgMBAAECggEAIxBO6i84igRQaam48NY4rd0WUIA+7cEpBkAjnZ5Daqyi
Dl0TQ7QLpt7NFurXl84b6hl/IMoZBFqUR3lPT4EUvPZ8ThKkAnLiI+vg4B9o+hdB
kRWux08PHbuLr3gfmVwGfOCRA7/cFRp3YnGKXiQUTpaCXB8pyNTvBcnRxur+DumR
lXOd/ROXYWgaiFZZGo78gLtbCCsXafYnFMTc0Q9GwHRXiDwzxo4D8Mqj3s8qrx1T
eZfiMiUSAzH+0kUZfuAUU1Xuiqzw7MJJ+j1IzEw+VuNsGrMCSis7ouOq5NcM/FJn
tfrj5dfW8bj+kwob8g4DhGtX52WKGXpsypWKbG5nkQKBgQDKg6emz2Uw9ogzG3Gk
jm47hlKnP1AqOOgWUZQ15W8tbDGdVqIcTmBwQEDkm8FenD1DWtFAlBzUPK32U/hC
Ox42qTcILcYzF+egF92IoV71I3x/LAV/odR0JO5Jh9EXsSGwV4rgEU7ogoYWIruE
vHrcGtAyWDBy/YpF3dBu+TJeeQKBgQC1P9S7xyAtMj6SxL+rj9gKsYzlvtQsYFLa
L0j3RnnKBX5gURU6h26Fl9XKDoBDLpUd1Ea1jnWUq+F6QtanbRtcNtUmBB2Z8pDM
NeiWPRzzJX2PsJwnPsA4ux+C909Ko3yBLCfI7YqjzAxSLVGL6T2Q3Em/5aV04Cze
cwnolIdTKwKBgBnLw2NAL8eY36iC6mrnqarzZTvgmLmIHigZpCNpYkwK6Bb+ng+0
/BvQU3PLU0pV5Ifb3aO4OiPextoFwC3Pkf2seFIWYpTHir2dzJ5Gz+2x433fgaPM
XV+eBKxhHIVEDuKDhDEeg0qitanEKtaxm4TF9Zc0HJfJK//STWaVX5EhAoGAfGyr
X5UdM6mwZxUF94Kx7vVgIj/Ua/pcJkgbsRUCens2/GvtRNbAOpm3PBSkXHpYB7g4
Kl73vO4ZxdKohRtTkwRZYtWkdJCecnH3j1u4yfpMrh2xtQdQ8iETStb36ec9i3eC
gF8Bs9xaAPf3aTLe/tkbD89YvFlAtB0JCk8cby0CgYBs3j0XTNl+SG0H6iI5G/PV
VgdHWzhwZ8cUUnV9pKOI2jqumzgHXwaagNR8Di8g3A+qUHlk8Dih1HJsXCiH1t7A
+5P+GXkJu+AszdkC5DZDa9SSjNXy6GfP9z7DU0DEk5SNfvF8Qq1eoO+r3UwZCTkx
hWz3ghWk7WdHUQhs2z8YpA==
-----END PRIVATE KEY-----
`

const testCert = 
`
-----BEGIN CERTIFICATE-----
MIIC0zCCAb2gAwIBAgIBATALBgkqhkiG9w0BAQswHjEcMAkGA1UEBhMCUlUwDwYD
VQQDHggAVABlAHMAdDAeFw0xNjAyMDEwNTAwMDBaFw0xOTAyMDEwNTAwMDBaMB4x
HDAJBgNVBAYTAlJVMA8GA1UEAx4IAFQAZQBzAHQwggEiMA0GCSqGSIb3DQEBAQUA
A4IBDwAwggEKAoIBAQCPYZQ4xTb7pyovN+5oGVNVLjZ+UuQYWCbWR/DCAbWtKiHx
UqeR1r9OzWF6n70VUbrGsf3EshirapD44quIFKQblsoyG0iE4Mg4END9yMhjzaXB
+wvR5jHAsYPfquF3nbs8Bw7wmZgYQX9NwW45kvF1jwWVrQCnofLJLZBskKrgzfZE
mWYxZ6Y2slvCBIP/ScoSPQ2dtvK8ZV1TlFlFmJ6AeuFYGi46Us9MTUG8by3VG80Y
uJlZG69GIWrwWhUGBx47DNVYtkmP3V5V+OZFGHQROiA15ADzvaSefUmGlcRpNqQD
8Gj0jxgk2W2qCcIkd0PHFYr4vkYHB7K/ZET15hlTAgMBAAGjIDAeMA8GA1UdEwQI
MAYBAf8CAQMwCwYDVR0PBAQDAgAGMAsGCSqGSIb3DQEBCwOCAQEATH8i0XlW+sbg
1z4EbqQ4RlqmIIYPTdOZrvgJkNU9zMxh6JDkSImrKlWiCYr+oBIJRTJAnYDAbzGN
suKaPFqTpQVZojmTpiO0WyKRTf0vrWPwxOUbqpzRVE2qiwhwMcWonJPFnkL0i6aB
Ejf9s8rbv4qoyl1WktHlcbaVQMFNF4V0KLViZW8wPWUMSfXQkq6LWOwH0b87cXFM
+j3ITjJik4eU5tPGAkY/CmDIDSwocaOv3JnjCtU7aVpuxwSjFs0HNMFPAseq8UlO
xjCEFVmxOR1/glo+/hTH0sD1t6yg4CoN/RMBnEU81Ayvahz4IMXOIGVkFw7PWp4S
qUnxshOHtQ==
-----END CERTIFICATE-----
`
if (Common.VERBOSE_LOGS) if (Common.VERBOSE_LOGS) console.log("Background script finished loading 123!")
testSignVerify()
async function testSignVerify() {
    if (Common.VERBOSE_LOGS) if (Common.VERBOSE_LOGS) console.log("Test signing and verifying")
    try {
        const testString = `testString`
        let signedText = await Common.smimeSign(testString,testKey,testCert)
        let bodyPos = signedText.indexOf(testString)
        let modifiedSignedText = `${signedText.slice(0,bodyPos)}modifed${signedText.slice(bodyPos)}`
        let toUnixNewlineText = signedText.replaceAll('\r\n','\n')
        let verified = await Common.smimeVerify(signedText,testCert)
        let failedVerify = await Common.smimeVerify(modifiedSignedText,testCert)
        let unixVerify = await Common.smimeVerify(toUnixNewlineText,testCert)
        //if (Common.VERBOSE_LOGS) if (Common.VERBOSE_LOGS) console.log(`Test result: successful verify ${verified.signatureVerified}`, `unsucessful verify ${failedVerify.signatureVerified}`)
        if (Common.VERBOSE_LOGS) if (Common.VERBOSE_LOGS) console.log(`Unix newline version get verified?`,unixVerify.signatureVerified)
    } catch (e) {
        if (Common.VERBOSE_LOGS) if (Common.VERBOSE_LOGS) console.log('Test failed',`${e}`)
    }
        
}



