/** Bottom status text */
let statusText: HTMLDivElement
/** Singular testing button */
let testButton: HTMLButtonElement
/** Test input text field */
let testInput: HTMLInputElement

window.onload = function () {
    statusText = <HTMLDivElement>document.getElementById("text-desc1")
    testButton = <HTMLButtonElement>document.getElementById("button-test")
    testInput = <HTMLInputElement>document.getElementById("input-test")

    testButton.onclick = testEncryptAlert
}

function sendTestMessage() {
    testButton.disabled = true
    statusText.innerText = "Sent - now waiting for reply..."
    let sending:Promise<{response:string,echo:string}> = 
        browser.runtime.sendMessage(null,{type:"test_msg",echo:testInput.value})
    sending.then(val=>{
        testButton.disabled = false
        statusText.innerHTML = val.response + ' <br> Echo: ' + val.echo
    })

}

function testEncryptAlert() {
    testButton.disabled = true
    statusText.innerText = "Sent - now waiting for reply..." 
    let alertMsg = " "
    const payload = {
        type: "get_encrypted_mime_str",
        msg: testInput.value
    } 
    browser.runtime.sendMessage(null,payload)
    .then( val => { alertMsg = val })
    .catch( error => {
        console.error(error) 
        alertMsg = "error:\n"+error
    })
    .finally( () => {
        testButton.disabled = false
        statusText.innerText = alertMsg
        if (alertMsg.length>30) statusText.style.fontSize = "xx-small"
    })
}
