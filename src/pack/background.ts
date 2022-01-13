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
let encryptFlag = false
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
                messenger.composeAction.setBadgeText({
                    text: msg.signed ? TEXT_SIGN : TEXT_NOT_SIGN,
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
    if (Common.VERBOSE_LOGS) console.log("background got options first time")
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
    } catch (e) {if (Common.VERBOSE_LOGS) console.error(e)}
}

browser.tabs.onCreated.addListener(initReply)

/** Event which changes the body of a newly created reply tab according to reply settings */
async function initReply(tab:browser.tabs.Tab) {
    // dont continue if options were not initialized
    if (!options || !options.options) return
    // we only care about compose tabs
    if ((tab as messenger.tabs.Tab).type != "messageCompose") return
    // we only care about replies
    if ((await messenger.compose.getComposeDetails(tab.id)).type != "reply") return

    // make sure we wait for content scripts to finish loading
    const connected = await awaitScriptOnTab(tab.id)
    if (!connected) {
        if (Common.VERBOSE_LOGS) console.log(`Abort reply init on tab#${tab.id} -- could not connect!`)
        return
    }
    const dets = await messenger.compose.getComposeDetails(tab.id)
    const body = dets.body
    const doc = new DOMParser().parseFromString(body,'text/html')
    const originalSenderEmail = getEmailFromRecipient((typeof dets.to === 'string' ? dets.to : dets.to[0]) as string)
    if (Common.VERBOSE_LOGS) console.log(`initReply got body sent by: ${originalSenderEmail}!\n${body}`)
    // get the first blockquote with a "cite" attribute as our reply quote
    const quoteArr = Array.from(doc.querySelectorAll('blockquote[cite]'))
    // we dont care about this message anymore if there is not replied quote
    if (!quoteArr) return
    const replyQuote = quoteArr[0] as HTMLQuoteElement
    if (!replyQuote) return
    let origMessage = ""
    // we will consider original messages as the text within the reply quote (either in a pre tag or url encoded)
    if (replyQuote.querySelector('pre')) { //if there is a pre tag under blockquote we take inner
        origMessage = (replyQuote.querySelector('pre')).innerText
    } else {
        origMessage = decodeURIComponent( replyQuote.innerText)
    }
    // now we decrypt and get signiture body if possible
    let sign = false; let encr = false
    let processed = ""
    try {
        if (origMessage.startsWith("Content-Type: application/pkcs7-mime") && options.options.privateKey) {
            encr = true
            processed = await Common.smimeDecrypt(origMessage,options.options.privateKey)
        } else {
            sign = true
            processed = await Common.smimeGetSignatureBody(origMessage)
        }
        // at this point, processed is an html string of the original message 
        // if its a pre block, lets try decrypting or signing its body
        let procDoc = new DOMParser().parseFromString(processed,'text/html')
        let newProcessed = procDoc.querySelector('pre').innerText
        if (newProcessed.startsWith("Content-Type: application/pkcs7-mime") && options.options.privateKey) {
            processed = await Common.smimeDecrypt(newProcessed,options.options.privateKey)
            encr = true
        } else {
            sign = true
            processed = await Common.smimeGetSignatureBody(newProcessed)
        }
    } catch(e) {if (Common.VERBOSE_LOGS) console.error(e)} // if at any point it fails, we are good
    if (processed == "") return // the original message was not processed (meaning it was not SMIME)
    // now we must change the reply according to the options
    if (options.options.replyEncr) { // if option is set, we should replace the reply part entirely
        replyQuote.innerHTML = processed
    } else { // if option is unset, we should show it in a convenient transient view instead
        let s1 = ""
        if (sign&&encr) s1 = 'signed&nbsp;and&nbsp;encrypted'; else if (sign) s1='signed'; else if (encr) s1='encrypted';
        let notifHTML = /*html*/`
        <div class="nBarOuter nBarAnimIn">
        <div class="nBarLogo">&#8205;</div>
        <div class="nBarStatusContainer">
            <div class="nBarStatus tooltip" style="border: none; padding-left:0px;"> 
            <span class="font-sub font-spaced">&lt;&nbsp;contents&nbsp;of&nbsp;the&nbsp;${s1}&nbsp;original&nbsp;&gt;</span>
            <span class="tooltiptext">For your eyes only - this box will be removed when sending<br>Do not try to modify!</span>
            </div>
            <div class="flexBreak">&#8205;</div>
            <div class="nBarStatus" style="font-family: sans-serif; font-size: small; user-select: none; opacity:90%;">${processed}</div>
        </div>
        </div>
        `
        replyQuote.innerHTML = notifHTML+replyQuote.innerHTML // prepend our notification
    }
    // finally update the compose tab to reflect our changes to the body
    if (! doc.firstElementChild) return
    await messenger.compose.setComposeDetails(tab.id,{
        body: doc.firstElementChild.innerHTML
    })
    if (Common.VERBOSE_LOGS) console.log(`\n   OriginalMessage:\n${origMessage}\n\n   Processed:\n${processed}`)
    if (Common.VERBOSE_LOGS) console.log(`\n   New Body: ${(await messenger.compose.getComposeDetails(tab.id)).body}`)
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
    if (Common.VERBOSE_LOGS) console.log("background updated options")
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
const TEXT_SIGN = "SIG"
const TEXT_NOT_SIGN = ""
/** Sets the compose action badge globally acording to onSign option */
function initSignBadge() {
    if (Common.VERBOSE_LOGS) console.log("INIT SIGN BADGE")
    if (options && options.options) {
        let sign = options.options.autoSign
        messenger.composeAction.setBadgeBackgroundColor({ color: sign?COLOR_SIGN:COLOR_NOT_SIGN })
        messenger.composeAction.setBadgeText({ text: sign?TEXT_SIGN:TEXT_NOT_SIGN })
    }
}
/** Strips the extra html created by our notification bar logic to return the original body and returns the html content of the document body */
function stripArtifactsFromHTML(body:string): string {
    return stripAllQuery(body,'div.nBarOuter, .nStrip')
}
/** Generic version of stripNotificationBar that will remove all matched by the query */
function stripAllQuery(html:string, query:string): string {
    let doc = new DOMParser().parseFromString(html, 'text/html')
    let found = doc.querySelectorAll(query)
    found.forEach(elem=>{elem.remove()})
    return doc.body.innerHTML
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
/** Event listener for when a composed message is about to be sent */
async function onBeforeSendEncrSign(tab, dets) {
    if (Common.VERBOSE_LOGS) console.log("Starting onBeforeSend Handler")
    if (!options) return
    let cancel = false
    
    let finalDets:messenger.compose.ComposeDetails = { body: stripArtifactsFromHTML(dets.body) }
    let needSign = false, needEncr = false
    if (await composeGetSigned(tab.id)) needSign = true
    if (options.options && options.options.autoEncrypt || encryptFlag) needEncr = true
    encryptFlag = false // global encrypt flag used for send encrypted button override
    const both = needSign && needEncr
    if (needSign || needEncr) {
        let msg = ""; 
        if (needSign) msg += "signing"
        if (needSign && needEncr) msg += " and "
        if (needEncr) msg += "encrypting"
        msg = msg.charAt(0).toUpperCase() + msg.slice(1) + " to send..."
        browser.tabs.sendMessage(tab.id,{type:"notif", payload:[msg, "/-loader-/"]} as Message)
        await new Promise(r => setTimeout(r, 800)); 
    }
    if (needSign) { // do signed
        if (Common.VERBOSE_LOGS) console.log("auto signing!")
        let newDets = await sign(tab.id, finalDets.body)
        if (!newDets) {
            if (Common.VERBOSE_LOGS) console.error("Failed sign, halting send")
            cancel = true // cancel send if the warning option is set
        } else {
            finalDets.body = newDets.body
        }
    }
    if (!cancel && needEncr) { // do auto encrypt
        if (Common.VERBOSE_LOGS) console.log("auto encrypting!")
        let newDets = await encrypt(tab.id, finalDets.body)
        if (!newDets) {
        if (Common.VERBOSE_LOGS) console.error("Failed encryption, halting send if needed")
            cancel = options.options.warningUnsecure // cancel send if the warning option is set
        } else {
            finalDets.body = newDets.body
        }
    }
    // html encode before sending to retain mime node text without modifications in the plaintext version of email
    if (Common.VERBOSE_LOGS) console.log("OnBeforeSend unencoded body",JSON.stringify(finalDets.body))
    finalDets.body = encodeURIComponent(finalDets.body)
    if (Common.VERBOSE_LOGS) console.log("OnBeforeSend final encoded body",JSON.stringify(finalDets.body))
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
    // type header tags to look for
    const hPlaintext = "text/plain"; const hHTML = "text/html"
    currentlyViewedMessageId = msg.id
    let msgPart = await messenger.messages.getFull(msg.id)
    if (Common.VERBOSE_LOGS) console.dir(msgPart)
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
    // try and get plaintext part
    let found = searchParts(msgPart, hPlaintext)
    if (!found) { // compatability if the message was sent with plaintext
        if (Common.VERBOSE_LOGS) console.log("onDisplayDcrpVeri error: text/plain mimePart not found.")
        return
    }
    /** The workable string representation of the plaintext message body */
    let body = found.body
    // html decode the message
    body = decodeURIComponent(body)
    // parse html email as DOM
    let doc = new DOMParser().parseFromString(body,'text/html')
    const ctEncr = "Content-Type: application/pkcs7-mime"
    const ctSign = "Content-Type: multipart/signed"
    // stop parsing if this message is not smime
    if (! (body.startsWith(ctEncr) || body.startsWith(ctSign)) ) return  
    // sync up with the display script on window tab displaying the message
    let connected = await awaitScriptOnTab(tab.id)
    if (!connected) { // abort if connection failed (tab was closed already, timeout, etc)
        if (Common.VERBOSE_LOGS) console.log(`Abort decryption with content script on tab#${tab.id}`)
        return
    }
    // check that the user didnt click onto a different message
    if (msg.id != currentlyViewedMessageId) return
    // show notif bar prograss message
    await browser.tabs.sendMessage(tab.id,{type:"notif",payload:["Decrypting and verifying SMIME message",`/-loader-/`]})
    // start timer for minimum processing time
    let time = performance.now()
    // create result objects arrays that will contain the status outputs of decryption/verifiction 
    let decrypted: {success:boolean,msg}[] = [] , verified: {success:boolean,msg}[] = []
    while (true) {
        // If outermost node is an encrypted smime node, attempt to replace with decrypted 
        if (body.startsWith(ctEncr)) {
            const result = await decrypt(body)
            if (result[0] != null) body = result[0]
            decrypted.push(result[1])
            // if last decryption was not successful, do not process any further
            if (!decrypted[decrypted.length-1].success) break
            continue
        }
        // If the outermost node is a signed smime node, attempt to verify and replace with content
        if (body.startsWith(ctSign)) {
            const result = await verify(body, sender)
            if (result[0] != null) body = result[0]
            verified.push(result[1])
            // if last decryption was not successful, do not process any further
            if (!verified[verified.length-1].success) break
            continue
        }
        // if the body is no longer an smime node (missing the content type heading): assume we are done
        else break
    }
    // set up the final notifications to show in the display window
    let finalNotifs = []
    if (decrypted.length>0) {
        finalNotifs.push(decrypted[decrypted.length-1].msg)
        if (verified.length>0) finalNotifs.push('/-break-/') // split up the notifications to a new row
    }
    // push the last "signed" status to the notifications to show
    if (verified.length>0) finalNotifs.push(verified[verified.length-1].msg)
    else finalNotifs.push(`<span class="color-mid">Message not signed by sender</span>`)

    // consider minimum processing time
    let duration = performance.now() - time
    const requiredDuration = 800
    if (duration < requiredDuration) {
        // let elapse minimum processing time for security/usability
        await new Promise(r => setTimeout(r, requiredDuration - duration)); 
    }
    // one final check that the user is still looking at the same message tab orignally clicked on
    if (msg.id != currentlyViewedMessageId) return

    // replace the displayed message with the new processed body
    await browser.tabs.sendMessage(tab.id,{type:"replace", payload:body})
    // show the final notification bar 
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
            if (Common.VERBOSE_LOGS) console.log(`Ping success to tab#${tabId}: "${response}"`)
            found = true
        } catch (e) {
            if (Common.VERBOSE_LOGS) console.log(`Failed ping to tab#${tabId} - #${i}`,e)
            await new Promise(r => setTimeout(r, interval));
            i++
        }
    }
    return found
}
/** Attempt to decrypt given string of a full smime encrypted node 
 *  @returns [ new-body-to-set , result-description-object ] tuple. Null body = no changes.
*/
async function decrypt(node:string): Promise<[string,{success:boolean,msg:string[]}]> {
    if (!options.options || !options.options.privateKey) { // fail if missing private key
        return [ null, {
            success: false,
            msg: [
                `<span class="color-neg">SMIME Decryption Failed</span>`,
                `<span class="font-sub"><i>Private Key</i> must be configured in settings</span>`
            ]
        } ]
    }
    try {
        let decryptedBlock = await Common.smimeDecrypt(node,options.options.privateKey)
        return [ decryptedBlock, {
            success: true,
            msg: [`<span class="color-pos">SMIME Message Decrypted</span>`,`<span class="font-sub">This email was for your eyes only</span>`]
        } ]
    } catch (e) {
        return [ null, {
            success: false,
            msg: [`<span class="color-neg">SMIME Decryption Error</span>`,`<pre class="font-sub">${e}</pre>`]
        } ]
    }
}
/** Attempt to verify given string of a full smime signed node 
 *  @returns [ new-body-to-set , result-description-object ] tuple. Null body = no changes.
*/
async function verify(node:string, sender:string): Promise<[string, {success:boolean,msg:string[]} ]> {
    try {
        // set true for testing (disable dane and test signing with a given cert)
        const USE_TEST_CERT_INSTEAD_OF_DANE = false
        let cert
        if (USE_TEST_CERT_INSTEAD_OF_DANE) cert = testCert
        try {
            if (!cert) cert = await getCertFromDANE(sender)
        } catch (e) { // could not find cert over dane: fail and return
            const newBody = await Common.smimeGetSignatureBody(node)
            return [ newBody, {
                success: false,
                msg: [
                    `<span class="color-neg">Signature unverified</span>`,
                    `<span class="font-sub">Unable to find <i>${sender}</i> certificate over DANE</span>`,
                    `<pre class="font-sub">${e}</pre>`
                ]
            } ]
        }
        // nominally, try to verify and record response, but always return the inner body
        let verified = (await Common.smimeVerify(node,cert)).signatureVerified
        const newBody = await Common.smimeGetSignatureBody(node)
        return [ newBody, {
            success: verified,
            msg: [
                verified?`<span class="color-pos">Signature Verified</span>`
                :`<span class="color-neg">Signature Unverified</span>`,
                verified?`<span class="font-sub">From <i>${sender}</i></span>`
                :`<span class="font-sub">Mail does not match signiture!</span>`
            ]
        } ]
    } catch (e) { // any other issues with verification
        return [ null, {
            success: false,
            msg: [
                `<span class="color-neg">Signature unverified</span>`,
                `<pre class="font-sub">${e}</pre>`
            ]
        } ]
    }
}

/** 
 * Given the tab ID of a composition pane, will replace the body with encrypted text 
 *  @returns the updated details object, or null on error (will generate correct error messsaging on screen) 
 */
async function encrypt(tabId:number, overrideBody?:string): Promise<messenger.compose.ComposeDetails> {
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
        let cfSMIMEA = await Common.DNSGetSMIMEA( getEmailFromRecipient((typeof composeDets.to === 'string' ? composeDets.to : composeDets.to[0]) as string) )
        if (Common.VERBOSE_LOGS) console.dir(cfSMIMEA)
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
        try { body = stripArtifactsFromHTML(body) } 
        catch (e) { browser.tabs.sendMessage(tabId,{type:"notif",payload:["Compose body HTML stripping error...",`<pre>${e}</pre>`]}); return null }
        // encrypt body
        if (Common.VERBOSE_LOGS) console.log("Encrypt body",JSON.stringify(body))
        encryptedBody = await Common.smimeEncrypt(body,recipientCert)
        if (Common.VERBOSE_LOGS) console.log("Encrypted output",JSON.stringify(encryptedBody))
    } catch(e) {
        if (Common.VERBOSE_LOGS) console.log("Encryption error", e)
        browser.tabs.sendMessage(tabId,{type:"notif",payload:["Encryption error...",`<pre>${e}</pre>`]})
        return null
    }
    /** Value to return - object containing the updated body of the mail before sending */
    let detUpdate: messenger.compose.ComposeDetails
    try {
        let encodedBody = encryptedBody
        detUpdate = { body : encodedBody}
        await messenger.compose.setComposeDetails(tabId,detUpdate)
        // send update notif with a delay, to allow compose details to update first
        browser.tabs.sendMessage(tabId,{type:"notif", payload:["Encryption complete",`To: <span class="color-green">${composeDets.to[0]}</span>`]})
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
async function sign(tabId:number, overrideBody?:string, showEndNotif?:boolean): Promise<messenger.compose.ComposeDetails> {
    let composeDets = await messenger.compose.getComposeDetails(tabId)
    try {
        if (!options) throw new Error("Options not configured")
        if (!options.options.email) throw new Error("Sender email not configured")
        let cert: string = null
        if (options.options.cert) cert = options.options.cert
        if (!cert) cert = await getCertFromDANE(options.options.email)
        //if (Common.VERBOSE_LOGS) if (Common.VERBOSE_LOGS) console.log("SIGN: GOT CERT",cert)

        let body = overrideBody? overrideBody: composeDets.body
        try { body = stripArtifactsFromHTML(body) } 
        catch (e) { if (Common.VERBOSE_LOGS) console.log(e); browser.tabs.sendMessage(tabId,{type:"notif",payload:["Compose body HTML stripping error...",`<pre>${e}</pre>`]}); return null }
        //if (Common.VERBOSE_LOGS) console.log("SIGN: BODY",body)
        if (!options.options.privateKey || options.options.privateKey.length==0) throw new Error("Your signing key must be set in options")
        if (Common.VERBOSE_LOGS) console.log("Signing body",JSON.stringify(body))
        body = await Common.smimeSign(body,options.options.privateKey,cert)
        if (Common.VERBOSE_LOGS) console.log("Signed output",JSON.stringify(body))
        let detUpdate: messenger.compose.ComposeDetails
        try {
            let encodedBody = body
            detUpdate = { body: encodedBody}
            await messenger.compose.setComposeDetails(tabId,detUpdate)
            // send update notif with a delay, to allow compose details to update first
            if (showEndNotif) browser.tabs.sendMessage(tabId,{type:"notif", payload:["Signing complete",`By: <span class="color-green">${options.options.email}</span>`]})
        } catch (e) {
            browser.tabs.sendMessage(tabId,{type:"notif",payload:["Composition error...",`<pre>${e}</pre>`]})
            return null
        }
    
        return detUpdate
    } catch (e) {
        if (Common.VERBOSE_LOGS) console.log("Signing error", e)
        browser.tabs.sendMessage(tabId,{type:"notif", payload:["Signing error", `<pre>${e}</pre>`]})
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
if (Common.VERBOSE_LOGS) console.log("Background script finished loading 123!")
testSignVerify()
async function testSignVerify() {
    if (Common.VERBOSE_LOGS) console.log("Test signing and verifying")
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
        if (Common.VERBOSE_LOGS) console.log(`Unix newline version get verified?`,unixVerify.signatureVerified)
    } catch (e) {
        if (Common.VERBOSE_LOGS) console.log('Test failed',`${e}`)
    }
        
}



