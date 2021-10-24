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
let replyEncr: HTMLInputElement
let sendStats: HTMLInputElement

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
    replyEncr = <HTMLInputElement>document.getElementById("opt_replyEncr")
    sendStats = <HTMLInputElement>document.getElementById("optSendStats")
    
    async function onSaveOpts(ev:Event) {
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
            autoSign: !!autoSign.checked,
            replyEncr: !!replyEncr.checked
        }   }
        // check if first time saving options
        let options = <Options> await browser.storage.local.get('options')
        if (options && !options.options.randId) {
            // generate "randId" as a saved key to anonymously identify this user
            let key = Math.floor((Math.random() * (Math.pow(16,16)-Math.pow(16,15)-1) + Math.pow(16,15))).toString(16).toUpperCase() // 16-digit hex key
            // save key on first time options saving
            optionsToSet.options.randId = key
        } else if (options) { // if the key was already set, preserve that key
            optionsToSet.options.randId = options.options.randId
        }
        try{ // set the new options
            await browser.storage.local.set(optionsToSet)
        } catch(e) {
            showStatus(/*html*/`<span style="color:#D74E09">Error</span> on save: ${e}`)
        }
        showStatus(/*html*/`<span style="color:#CBEFB6">Saved</span> successfully`)
        // if send stats is checked, send the stats we care about
        if (sendStats.checked) {
            // create our data packet with a standard key names (below)
            let data = { 
                id: optionsToSet.options.randId,
                autoEncr: optionsToSet.options.autoEncrypt,
                autoSign: optionsToSet.options.autoSign,
                warnEncrFail: optionsToSet.options.warningUnsecure,
                replyEncr: optionsToSet.options.replyEncr
            }
            // hardcoded end point for now
            let endpointURL = 'https://aonova.ddns.net/kurer/options_stats.py'
            // send data
            await fetch(endpointURL, {
                method: 'POST', mode:'no-cors', cache:'no-cache', 
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(data)
            })
        }
        
        ev.preventDefault()
    }

    /* Save options of form submit*/
    mainForm.onsubmit = onSaveOpts

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
    try {
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
    } catch(e) {
        console.error(e) 
        location.reload() // failsafe to reload page if messed up refs 
    }
    
}
