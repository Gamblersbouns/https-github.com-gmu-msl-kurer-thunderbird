var encryptButton: HTMLButtonElement = null
var signButton: HTMLButtonElement = null
var desc: HTMLDivElement = null
var subtitle: HTMLDivElement = null
var options: Options = null
/** Communication port with background script */
var port:browser.runtime.Port = null

window.addEventListener('load',()=>{
    encryptButton = <HTMLButtonElement> document.getElementById("but_encrypt")
    signButton = <HTMLButtonElement> document.getElementById("but_sign")
    desc = <HTMLDivElement> document.getElementById("text-desc1")
    subtitle = <HTMLDivElement> document.getElementById("text-subtitle1")

    port = browser.runtime.connect()
    
    port.onMessage.addListener((msg:Message)=>{
        if (msg.type == "sendOptions") {
            console.dir(msg)
            optionsUpdate(msg.payload)
            console.log("composePopup updated options")
        }
    })
    let msg: Message = {type: "getOptions"}
    port.postMessage(msg)
    encryptButton.addEventListener("click",()=>{onClickEncrypt()})
    signButton.addEventListener("click",()=>{onClickSign()})

})

// @ts-ignore
function optionsUpdate(newOptions: Options) {
    options = newOptions
    console.dir(options)
    if (options && options.options) {
        let descText = ""
        if (options.options.autoEncrypt) {
            encryptButton.textContent = "Will Encrypt on Send"
            encryptButton.disabled = true
            descText += "Mail will be encrypted on sending for recipients whose certs can be found via DANE<br>"
        }
        else if (!options.options.autoEncrypt) {
            encryptButton.textContent = "Encrypt"
            encryptButton.disabled = false
            descText += "You can manually choose to encrypt this message for the recipient<br>"
        }
        if (options.options.autoSign) {
            signButton.textContent = "Will Sign on Send"
            signButton.disabled = true
            descText += "Mail will be signed when sending as configured in settings<br>"
        }
        else if (!options.options.autoEncrypt) {
            signButton.textContent = "Sign"
            signButton.disabled = false
            descText += "You can manually sign this message<br>"
        }
        desc.innerHTML = descText
    }
}

function onClickEncrypt(){
    encryptButton.disabled = true
    browser.runtime.sendMessage({type:"encrypt"}as Message)
    window.setTimeout(()=>{encryptButton.disabled = false}, 3000)
}

function onClickSign(){
    encryptButton.disabled = true
    browser.runtime.sendMessage({type:"sign"}as Message)
    window.setTimeout(()=>{encryptButton.disabled = false}, 3000)
}