let mainForm:HTMLFormElement
let privateKey:HTMLTextAreaElement
let cacheName:HTMLInputElement
let cacheCert:HTMLTextAreaElement
let statusBar: HTMLDivElement

type Options = {
    /** Unencrypted private key (temp. testing use) */
    privateKey: string
    /** Array of cached name-cert associations */
    cache: {
        name: string
        cert: string
    }[]
}

window.onload = () => {
    mainForm= <HTMLFormElement>document.getElementById("mainForm")
    privateKey = <HTMLTextAreaElement>document.getElementById("privateKey")
    cacheName= <HTMLInputElement>document.getElementById("1_cacheName")
    cacheCert= <HTMLTextAreaElement>document.getElementById("1_cacheCert")
    statusBar = <HTMLDivElement>document.getElementById("statusbar")

    /* update the form with the currently stored values */
    browser.storage.local.get('options')
    .then((options:Options)=>{
        console.dir(options)
        if (options.privateKey!=null) {privateKey.innerHTML = options.privateKey}
        if (options.cache && options.cache[0]) {
            cacheName.value = options.cache[0].name
            cacheCert.innerHTML = options.cache[0].cert
        }
        statusBar.innerText = "Loaded successfully"
    }, reason=>{statusBar.innerText = `Error on load: ${reason}`} )

    /* Intercept the submit form event and save the values*/
    mainForm.addEventListener('submit', event=>{
        browser.storage.local.set({
            options: {
                privateKey: privateKey.value.length>0 ? privateKey.value : null,
                cache: (cacheName.value.length>0 && cacheCert.value.length>0) ?
                    [{
                        cacheName: cacheName.value,
                        cacheCert: cacheCert.value
                    }]
                    : null
            }
        })
        .then(()=>{statusBar.innerText = "Saved successfully"},reason=>{statusBar.innerText = `Error on save: ${reason}`})

        event.preventDefault()
    })
}

