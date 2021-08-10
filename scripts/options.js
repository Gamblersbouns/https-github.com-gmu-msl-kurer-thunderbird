let mainForm;
let privateKey;
let cacheName;
let cacheCert;
let statusBar;
window.onload = () => {
    mainForm = document.getElementById("mainForm");
    privateKey = document.getElementById("privateKey");
    cacheName = document.getElementById("1_cacheName");
    cacheCert = document.getElementById("1_cacheCert");
    statusBar = document.getElementById("statusbar");
    /* update the form with the currently stored values */
    browser.storage.local.get('options')
        .then((options) => {
        console.dir(options);
        if (options.privateKey != null) {
            privateKey.innerText = options.privateKey;
        }
        if (options.cache && options.cache[0]) {
            cacheName.value = options.cache[0].name;
            cacheCert.innerText = options.cache[0].cert;
        }
        statusBar.innerText = "Loaded successfully";
    }, reason => { statusBar.innerText = `Error on load: ${reason}`; });
    /* Intercept the submit form event and save the values*/
    mainForm.addEventListener('submit', event => {
        browser.storage.local.set({
            options: {
                privateKey: privateKey.value.length > 0 ? privateKey.value : null,
                cache: (cacheName.value.length > 0 && cacheCert.value.length > 0) ?
                    [{
                            cacheName: cacheName.value,
                            cacheCert: cacheCert.value
                        }]
                    : null
            }
        })
            .then(() => { statusBar.innerText = "Saved successfully"; }, reason => { statusBar.innerText = `Error on save: ${reason}`; });
        event.preventDefault();
    });
};
