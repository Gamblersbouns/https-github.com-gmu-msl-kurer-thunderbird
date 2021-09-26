
// This content script injects a notification bar which can be interfaced via runtime messages of type "notif"

/** Communication port with background script */
var port = browser.runtime.connect()

log("loaded Message Display Content Script!")

function initNotifBar(text: string[]) {
    const notifBar = document.createElement("div");
    notifBar.classList.add("nBarOuter","nBarAnimIn")
    const notifLogo = document.createElement("div");
    notifLogo.classList.add("nBarLogo")
    notifBar.appendChild(notifLogo)
    text.forEach(t=>{
        let notifText = document.createElement("div");
        notifText.classList.add("nBarStatus")
        notifText.innerHTML = t
        notifBar.appendChild(notifText)
    })
    document.body.insertBefore(notifBar, document.body.firstChild);
}
/** Shows the passed notification html in the notification bar */
function showNotif(notif:string[]) {
    let foundExistingBar = document.firstElementChild.querySelector("div.nBarOuter")
    if (!foundExistingBar) initNotifBar(notif)
    else {
        let notifBar = foundExistingBar as HTMLDivElement 
        Array.from(notifBar.getElementsByClassName("nBarStatus"))
        .forEach(t=>t.remove())
        notif.forEach(t=>{
            let notifText = document.createElement("div");
            notifText.classList.add("nBarStatus")
            notifText.innerHTML = t
            notifBar.appendChild(notifText)
        })
        notifBar.classList.remove("nBarAnimIn")
        notifBar.classList.remove("nBarAnimColorin")
        void notifBar.offsetWidth
        notifBar.classList.add("nBarAnimColorin")
        
    }
}
/** Replace the html body with given html */
async function replace(newBody:string, delay?:number) {
    // wait for millis if necessary
    if (delay) await new Promise(r => setTimeout(r, delay))
    document.firstElementChild.querySelector("body").innerHTML = newBody
}

browser.runtime.onMessage.addListener((msg:Message)=>{
    if (!msg.type) return
    if (msg.type == "notif") {
         let notif = msg.payload
        if (msg.color) notif.forEach((v,i,a)=>{
            a[i] = `<span class="color-${msg.color}">${v}</span>`
        })
        if (msg.delay) {
            window.setTimeout(()=>{showNotif(notif)},msg.delay)
        }
        else {
            showNotif(notif)
        }
    } else if (msg.type == "replace") {
        replace(msg.payload, msg.delay)
    } else if (msg.type == "ping") { // returns a "ping" to a "ping"
        return Promise.resolve({response: "ping"})
    }
    
})

/** Transmit console log to background script */
function log(obj:any, dir?: boolean) {
    let message: Message = {type: dir?"dir":"log", payload: obj}
    port.postMessage(message)
}