/*----------------------------------------------------
 * © 2021 George Mason University 
 * For further information please contact ott@gmu.edu
------------------------------------------------------*/
var encryptButton: HTMLButtonElement = null
var signSwitch: HTMLInputElement = null
var desc: HTMLDivElement = null
var subtitle: HTMLDivElement = null
var options: Options = null
/** Communication port with background script */
var port:browser.runtime.Port = null
/** The compose tab id from which this this popup was clicked open*/
let composeTabId: number = null

window.addEventListener('load',()=>{
    initSwitchAnimation()
    encryptButton = <HTMLButtonElement> document.getElementById("but_encrypt")
    signSwitch = <HTMLInputElement> document.getElementById("switch_sign")
    desc = <HTMLDivElement> document.getElementById("text-desc1")
    subtitle = <HTMLDivElement> document.getElementById("text-subtitle1")

    port = browser.runtime.connect()
    signSwitch.disabled = true

    port.onMessage.addListener((msg:Message)=>{
        if (msg.type == "sendOptions") {
            console.dir(msg)
            optionsUpdate(msg.payload)
            console.log("composePopup updated options")
        } else if (msg.type == 'reply') {
            if (msg.query == 'composeTabId') {
                composeTabId = msg.tabId
                // get the state of the signed switch for this compose tab
                port.postMessage( {type: 'get', query: 'composeSign', tabId:msg.tabId } as Message )
            }
            if (msg.query == 'composeSign') {
                signSwitch.checked = msg.signed
                signSwitch.dispatchEvent(new Event('change'))
                signSwitch.disabled = false
            }
        }
    })
    // get the options 
    port.postMessage({ type: "getOptions" } as Message)
    // get the compose tab this popup is linked to
    port.postMessage({ type: "get", query: "composeTabId" } as Message)
    // handle input clicks
    encryptButton.addEventListener("click",()=>{onClickSendEcr()})
    signSwitch.addEventListener("click",()=>{onToggleSign()})

    
})

// @ts-ignore
function optionsUpdate(newOptions: Options) {
    options = newOptions
    console.dir(options)
    if (options && options.options) {
        let descText = ""
        if (options.options.autoEncrypt) {
            encryptButton.textContent = "Encrypt By Default"
            encryptButton.disabled = true
            descText += "Mail will be <b>sent encrypted</b> by default<br>"
        }
        else if (!options.options.autoEncrypt) {
            encryptButton.textContent = "Send Encrypted"
            encryptButton.disabled = false
            descText += "Click to send your email encrypted"
        }
        else if (options.options.warningUnsecure) {
            descText += "<b>Send Encrypted</b> will <i>halt</i> if recipient not found<br>"
        }
        else if (!options.options.warningUnsecure) {
            descText += "<b>Send Encrypted</b> will <i>send plain</i> if recipient not found<br>"
        }
        desc.innerHTML = descText
    }
}
/** When the user toggles the sign message switch, let background script know */
function onToggleSign() {
    port.postMessage({ 
        type: "action", 
        action: "composeSetSigned", 
        signed: signSwitch.checked,
        tabId: composeTabId 
    } as Message)
}
/** When the user clicks send encrypted button */
function onClickSendEcr() {
    encryptButton.disabled = true
    port.postMessage({ 
        type: "action", 
        action: "composeSendEncrypt",
        tabId: composeTabId
    } as Message)
    /** reenable the button after some time if the popup is still open (some error) */
    window.setTimeout(()=>{ if (encryptButton) encryptButton.disabled = false }, 1000 )
}

/** Animate glow on switch prompts depending on selection */
function initSwitchAnimation() {
    (<HTMLDivElement[]>Array.from(document.getElementsByClassName("switchBox")))
    .forEach(elem=>{
        let input = elem.querySelector("input")
        // set the "checked" class of the resepective label div on either side of the check switch 
        input.onchange = (ev:Event)=>{
            let input = <HTMLInputElement> ev.target
            let left = <HTMLDivElement>input.parentElement.parentElement.firstElementChild
            let right = <HTMLDivElement>input.parentElement.parentElement.lastElementChild
            void left.offsetWidth
            void right.offsetWidth 
            let checked = left.classList
            let unchecked = right.classList
            if (input.checked) [checked,unchecked] = [unchecked,checked]
            checked.add("checked")
            unchecked.remove("checked");
        }
        input.dispatchEvent(new Event('change'))
    })
}
/*----------------------------------------------------
 * © 2021 George Mason University 
 * For further information please contact ott@gmu.edu
------------------------------------------------------*/