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
    // communicate the changes in options
    ports.forEach(port => {
        let msg:Message = {
            type: "sendOptions",
            payload: options
        }
        port.postMessage(msg)
    })
    
})

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
        // search for recipient in trust cache
        let found = options.options.cache.find(item=>{item.name == data.recipient})
        if (!found) return new Promise((res,rej)=>{rej("Recipient cert not found")})
        return Common.smimeEncrypt(data.plaintext, found.cert)
    }

    if (data.type=="decrypt") {
        return Common.smimeDecrypt(data.ciphertext, options.options.privateKey, options.options.cache[0].cert)
    }
})

messenger.compose.onBeforeSend.addListener( (tab,dets)=> {

    console.log("on before send!")
    let htmlToPrepend = /*html*/ 
`
<div style="background-color: #0b1419; color: #98cee8; width:95%; margin: 10px auto; border-radius:0.8em;padding:5px; display:flex; justify-content:center;">Blocked send: ${(Math.random()*89999+10000).toFixed(0)}
</div> 
`
    let insert = dets.body.indexOf("<body>") + 6
    let newBody = dets.body.substring(0,insert) + htmlToPrepend + dets.body.substring(insert)
    let newDets: typeof dets = {body: newBody}
    return {cancel: false, details:newDets}
    // let cancel = false; let newDetails: messenger.compose.ComposeDetails = null
    // let found = options.options.cache.find(item=>{item.name == dets.to[0]})
    // if (!found) {
    //     cancel = true
    //     console.log("Recipient cert not found")
    //     return {cancel: cancel, details: newDetails}
    // }
    // Common.smimeEncrypt(dets.body, found.cert).finally(

    // )
    // return
})

messenger.messageDisplay.onMessageDisplayed.addListener( (tab,msg)=>{
    // for testing, sends some notifications after a while
    messenger.messages.getFull(msg.id)
    .then(msgPart=>{
        console.dir(msgPart)
        let notifs: Message[] = [
            {type: "notif", payload: ["Hi, this is a notification from Kurer!"]},
            {type: "notif", payload: [`This email has <span class="color-pos">${msgPart.parts[0].body.length}</span> characters.`]},
            {type: "notif", payload: ["This email was not <b>encrypted</b> or <b>signed</b>"], color: "neg"},
        ]
        window.setTimeout(()=>{browser.tabs.sendMessage(tab.id,notifs[0])},500)
        window.setTimeout(()=>{browser.tabs.sendMessage(tab.id,notifs[1])},2500)
        window.setTimeout(()=>{browser.tabs.sendMessage(tab.id,notifs[2])},5500)
    })

})


console.log("Background script finished loading 123!")

//console.log(`Test decode PEM:\n${Common.decodePem}`)