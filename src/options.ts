let mainForm:HTMLFormElement
let privateKey:HTMLTextAreaElement
let cert:HTMLTextAreaElement
let email:HTMLInputElement
let cacheName:HTMLInputElement
let cacheCert:HTMLTextAreaElement
let statusBar: HTMLDivElement
let autoEncrypt: HTMLInputElement
let sendWarning: HTMLInputElement
let autoSign: HTMLInputElement

window.onload = () => {
    mainForm= <HTMLFormElement>document.getElementById("mainForm")
    privateKey = <HTMLTextAreaElement>document.getElementById("privateKey")
    cert = <HTMLTextAreaElement>document.getElementById("cert")
    email = <HTMLInputElement>document.getElementById("email")
    cacheName= <HTMLInputElement>document.getElementById("1_cacheName")
    cacheCert= <HTMLTextAreaElement>document.getElementById("1_cacheCert")
    statusBar = <HTMLDivElement>document.getElementById("statusbar")

    autoEncrypt = <HTMLInputElement>document.getElementById("opt_autoEncrypt")
    sendWarning = <HTMLInputElement>document.getElementById("opt_sendWarning")
    autoSign = <HTMLInputElement>document.getElementById("opt_autoSign")

    /* Save options of form submit*/
    mainForm.onsubmit = ev=>{
        let optionsToSet:Options = {options: {
            privateKey: privateKey.value.length>0 ? privateKey.value : null,
            cert: cert.value.length>0 ? cert.value : null,
            email: email.value.length>0 ? email.value : null,
            cache: (cacheName.value.length>0 && cacheCert.value.length>0) ?
                [{
                    name: cacheName.value,
                    cert: cacheCert.value
                }] : null, // dont set cache if it is undefined
            // saving the toggle options
            autoEncrypt: !!autoEncrypt.checked,
            warningUnsecure: !!sendWarning.checked,
            autoSign: !!autoSign.checked
        }   }
        browser.storage.local.set(optionsToSet)
        .then(
            ()=>{showStatus(/*html*/`<span style="color:#CBEFB6">Saved</span> successfully`)},
            reason=>{showStatus(/*html*/`<span style="color:#D74E09">Error</span> on save: ${reason}`)}
        )
        
        ev.preventDefault()
    }

    /* Load options on form reset */
    mainForm.onreset = ev => {
        browser.storage.local.get('options')
        .then((result:Options)=>{
            if (!result.options) {statusBar.innerText = `No previously saved options found`; return}
            let options = result.options
            if (options.email!==undefined) {
                email.value = email.innerHTML = options.email
            }
            if (options.privateKey!==undefined) {
                privateKey.value = privateKey.innerHTML = options.privateKey
            }
            if (options.cert!==undefined) {
                cert.value = cert.innerHTML = options.cert
            }
            if (options.cache && options.cache[0]) {
                cacheName.innerHTML = cacheName.value = options.cache[0].name
                cacheCert.value = cacheCert.innerHTML = options.cache[0].cert
            }
            if (options.autoEncrypt!=null && autoEncrypt.checked != options.autoEncrypt )  autoEncrypt.click() 
            if (options.warningUnsecure!=null && sendWarning.checked != options.warningUnsecure ) sendWarning.click() 
            if (options.autoSign!=null && autoSign.checked != options.autoSign) autoSign.click()
            showStatus( /*html*/`<span style="color:#CBEFB6">Loaded</span> successfully`)
        }, reason=>{showStatus(/*html*/`<span style="color:#D74E09">Error</span> on load: ${reason}`)} )
        ev.preventDefault()
    }

    mainForm.dispatchEvent(new Event('reset'))
    toggleSwitchAnim()
}
/** Animate glow on switch prompts depending on selection */
function toggleSwitchAnim() {
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
/** 
 * Animate and show passed status html in the document's status bar area (designated id=statusbar) 
 * @param newStatus text content to set statusbar to (supports html tags, spans, class styles and the works)
 */
function showStatus(newStatus:string) {
    let statusBar = document.getElementById('statusbar')
    let statusText = <HTMLDivElement>document.getElementById('statustext')
    statusText.innerHTML = newStatus
    statusText.classList.remove('text-focus')
    void statusText.offsetWidth; // hack to refresh element visually
    statusText.classList.add('text-focus')

    statusBar.parentElement.classList.remove('color-change')
    void statusBar.parentElement.offsetWidth
    statusBar.parentElement.classList.add('color-change')

    for (let i=0;i<2;i++) statusBar.parentElement.classList.toggle('color-change-2x')
}
