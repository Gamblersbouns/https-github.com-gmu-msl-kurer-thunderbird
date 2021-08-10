/** Bottom status text */
let statusText;
/** Singular testing button */
let testButton;
/** Test input text field */
let testInput;
window.onload = function () {
    statusText = document.getElementById("text-desc1");
    testButton = document.getElementById("button-test");
    testInput = document.getElementById("input-test");
    testButton.onclick = testEncryptAlert;
};
function sendTestMessage() {
    testButton.disabled = true;
    statusText.innerText = "Sent - now waiting for reply...";
    let sending = browser.runtime.sendMessage(null, { type: "test_msg", echo: testInput.value });
    sending.then(val => {
        testButton.disabled = false;
        statusText.innerHTML = val.response + ' <br> Echo: ' + val.echo;
    });
}
function testEncryptAlert() {
    testButton.disabled = true;
    statusText.innerText = "Sent - now waiting for reply...";
    let alertMsg = " ";
    const payload = {
        type: "get_encrypted_mime_str",
        msg: testInput.value
    };
    browser.runtime.sendMessage(null, payload)
        .then(val => { alertMsg = val; })
        .catch(error => {
        console.error(error);
        alertMsg = "error:\n" + error;
    })
        .finally(() => {
        testButton.disabled = false;
        statusText.innerText = alertMsg;
        if (alertMsg.length > 30)
            statusText.style.fontSize = "xx-small";
    });
}
