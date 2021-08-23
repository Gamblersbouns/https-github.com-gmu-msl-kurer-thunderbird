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
        autoDecrypt:true, autoEncrypt:true, autoSign:true, warningUnsecure:true
    }
}

async function fetchOptionsOnStartup() {
    options = await browser.storage.local.get("options")
    if (!options) await browser.storage.local.set(defaultOptions)
    console.log("background got options first time")
}

document.addEventListener("DOMContentLoaded",registerScripts)

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
    Object.assign(options,changes.options.newValue)
    console.log("background updated options")
    console.dir(options)
    // communicate the changes in options
    ports.forEach(port => {
        let msg:Message = {
            type: "sendOptions",
            payload: options
        }
        port.postMessage(msg)
    })
    
})

/** Strips the extra html created by our notification bar logic to return the original body */
function stripNotificationBar(body:string): string {
    let doc = new DOMParser().parseFromString(body,'text/html')
    let notifbar = doc.querySelector("div.nBarOuter")
    if (notifbar) notifbar.remove()
    return doc.firstElementChild.outerHTML         
}

browser.runtime.onMessage.addListener((data: Message)=>{
    // test message just sends back the date and an echo with a random delay of a couple seconds
    // if (data.type == "test_msg") {
    //     return new Promise(resolve=>{
    //         setTimeout(()=>{ resolve(
    //             { response: `return message on ${(new Date()).toLocaleDateString()}`, echo: data.echo }
    //         )},Math.random()*3000+500)
    //     }) 
    // }
    /* test message which returns the mime string of the given text, with preset keys, certs, and headers 
            message object: {
                type: "get_encrypted_mime_str",
                msg: <string body of mime message>   
            }
    */

    // if (data.type == "get_encrypted_mime_str") {
    //     return Common.smimeEncrypt(data.msg,test_cert)
    // }

    if (data.type=="encrypt") {
        let tab = data.tabId
        if (!tab) {
            browser.windows.getAll({populate:true})
            .then((w)=>{ console.dir(w); encrypt(w.find(w=>w.type=="messageCompose"as any&&w.focused).tabs[0].id) })
            //browser.tabs.query({}).then(tabs=>console.dir(tabs))
            // @ts-ignore
            // browser.tabs.query({windowType:"messageCompose", currentWindow:true}).then(v=>{
            //     encrypt(v[0].id)
            // })
        }
        else {
            encrypt(tab)
        }
    }

    if (data.type=="decrypt") {
        return Common.smimeDecrypt(data.ciphertext, options.options.privateKey, options.options.cache[0].cert)
    }
})
/** Clean up the message before sending (remove any possible notification bars) */
messenger.compose.onBeforeSend.addListener( (tab,dets)=> {
    let newBody = null
    if (options.options.autoEncrypt) {
        console.log("auto encrypting!")
        encrypt(tab.id).then(()=>{
            return {cancel: false}
        })
    }
    else {
        newBody = stripNotificationBar(dets.body)
        return {cancel: false, details: {body: newBody}}
    }
})

messenger.messageDisplay.onMessageDisplayed.addListener( (tab,msg)=>{
    // for testing, sends some notifications after a while
    messenger.messages.getFull(msg.id)
    .then(msgPart=>{
        let fullBody = ""
        constructFullBody(msgPart)
        function constructFullBody(msgPart: messenger.messages.MessagePart) {
            if (msgPart.contentType=="text/plain" && msgPart.body) fullBody + msgPart.body
            if (msgPart.parts) msgPart.parts.forEach(p=>{constructFullBody(p)})
        }
        console.log(fullBody)
        if (!fullBody.startsWith("Content-Type: application/pkcs7-mime;")) {
            browser.tabs.sendMessage(tab.id,{type:"notif",payload:["Debug","Not an SMIME encrypted message"]})
        }
        try {
            Common.smimeDecrypt(fullBody,options.options.privateKey,options.options.cache[0].cert).then(d=>{
                browser.tabs.sendMessage(tab.id,{type:"notif",payload:["Decrypted",d]})
            })
        } catch (e) {browser.tabs.sendMessage(tab.id,{type:"notif",payload:["Decryption error...",e]})}
        
        // console.dir(msgPart)
        // let notifs: Message[] = [
        //     {type: "notif", payload: ["Hi, this is a notification from Kurer!"]},
        //     {type: "notif", payload: [`This email has <span class="color-pos">${msgPart.parts[0].body.length}</span> characters.`]},
        //     {type: "notif", payload: ["This email was not <b>encrypted</b> or <b>signed</b>"], color: "neg"},
        // ]
        // window.setTimeout(()=>{browser.tabs.sendMessage(tab.id,notifs[0])},500)
        // window.setTimeout(()=>{browser.tabs.sendMessage(tab.id,notifs[1])},2500)
        // window.setTimeout(()=>{browser.tabs.sendMessage(tab.id,notifs[2])},5500)
    })

})

async function decrypt(tabId:number) {

}

/** 
 * Given the tab ID of a composition pane, will replace the body with encrypted text 
 *  @returns the updated details object, or null on error (will generate correct error messsaging on screen) 
 */
async function encrypt(tabId:number): Promise<string> {
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
            let answer = JSON.stringify(cfSMIMEA.Answer)
            browser.tabs.sendMessage(tabId,{type:"notif",payload:["Target record not found...","Other",`<pre style="font-size:xxx-small">${answer}<pre>`]})
            return null
        }
    }
    let encryptedBody
    try {
        let body = composeDets.body
        try { body = stripNotificationBar(body) } 
        catch (e) { browser.tabs.sendMessage(tabId,{type:"notif",payload:["Compose body HTML stripping error...",e]}) }
        encryptedBody = await Common.smimeEncrypt(body,recipientCert)
    } catch(e) {
        browser.tabs.sendMessage(tabId,{type:"notif",payload:["Encryption error...",e]})
        return null
    }
    /** Value to return - object containing the updated body of the mail before sending */
    let detUpdate
    try {
        detUpdate = { body: encryptedBody }
        messenger.compose.setComposeDetails(tabId,detUpdate)
        // send update notif with a delay, to allow compose details to update first
        browser.tabs.sendMessage(tabId,{type:"notif", delay:500, payload:["Encryption complete",`To: <span class="color-green">${composeDets.to[0]}</span>`]})
    } catch (e) {
        browser.tabs.sendMessage(tabId,{type:"notif",payload:["Composition error...",e]})
        return null
    }
    return detUpdate
}

console.log("Background script finished loading 123!")

//console.log(`Test decode PEM:\n${Common.decodePem}`)