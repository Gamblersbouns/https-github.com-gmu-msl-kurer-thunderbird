var mainButton: HTMLButtonElement = null
var desc: HTMLDivElement = null
var subtitle: HTMLDivElement = null
var options: Options = null
/** Communication port with background script */
var port:browser.runtime.Port = null

window.addEventListener('load',()=>{
    mainButton = <HTMLButtonElement> document.getElementById("button1")
    desc = <HTMLDivElement> document.getElementById("text-desc1")
    subtitle = <HTMLDivElement> document.getElementById("text-subtitle1")

    port = browser.runtime.connect()
    let msg: Message = {type: "getOptions"}
    port.postMessage(msg)
    port.onMessage.addListener((msg:Message)=>{
        if (msg.type == "sendOptions")
        optionsUpdate(msg.payload)
        console.log("composePopup updated options")
    })
    mainButton.addEventListener("click",()=>{onClickEncrypt()})
})

// @ts-ignore
function optionsUpdate(newOptions: Options) {
    options = newOptions
    console.dir(options)
    if (options && options.options) {
        if (options.options.autoEncrypt) {
            mainButton.textContent = "Will Encrypt on Send"
            mainButton.disabled = true
            desc.innerText = "Mail will be encrypted on sending for recipients whose certs can be found via DANE"
        }
        else if (!options.options.autoEncrypt) {
            mainButton.textContent = "Encrypt"
            mainButton.disabled = false
            desc.innerText = "You can manually choose to encrypt this message for the recipient"
        }
    }
}

function onClickEncrypt(){
    mainButton.disabled = true
    browser.runtime.sendMessage({type:"encrypt"}as Message)
    window.setTimeout(()=>{mainButton.disabled = false}, 1000)
    
}