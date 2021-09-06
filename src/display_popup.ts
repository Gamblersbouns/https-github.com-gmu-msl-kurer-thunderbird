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
    
    port.onMessage.addListener((msg:Message)=>{
        if (msg.type == "sendOptions")
        optionsUpdate(msg.payload)
        console.log("displayPopup updated options")
        console.dir(options)
    })
    let msg: Message = {type: "getOptions"}
    port.postMessage(msg)
})

// @ts-ignore
function optionsUpdate(newOptions: Options) {
    options = newOptions

    if (options && options.options) {
        if (options.options.autoDecrypt) {
            mainButton.textContent = "Auto-decryption Enabled"
            mainButton.disabled = true
        }
        else if (options.options.autoDecrypt) {
            mainButton.textContent = "Not Encrypted"
            mainButton.disabled = true
        }
    }
}