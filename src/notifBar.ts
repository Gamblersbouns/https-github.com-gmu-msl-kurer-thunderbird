
/*----------------------------------------------------
 * © 2021 George Mason University 
 * For further information please contact ott@gmu.edu
------------------------------------------------------*/
// This content script injects a notification bar which can be interfaced via runtime messages of type "notif"

/** Communication port with background script */
var port = browser.runtime.connect()

log("loaded Message Display Content Script!")
/** Creates and displays a notification bar with the given html strings as the content
 *  at the top of the page/email body
 */
function initNotifBar(text: string[]) {
    const notifBar = document.createElement("div");
    notifBar.classList.add("nBarOuter","nBarAnimIn", "nSingleton")
    const notifLogo = document.createElement("div");
    notifLogo.classList.add("nBarLogo")
    notifBar.appendChild(notifLogo)
    const notifContainer = document.createElement("div");
    notifContainer.classList.add("nBarStatusContainer")
    notifBar.appendChild(notifContainer)
    text.forEach(t=>{
        let notifText = document.createElement("div");
        if (t == "/-break-/") { // magic string for forced new row in notification
            notifText.classList.add("flexBreak")
            notifText.innerHTML = "&#8205;"
        } else if (t == "/-loader-/") { // magic string for animated loader
            notifText.classList.add("nBarStatus")
            notifText.innerHTML = `<span class="loader"><span class="loader-box"></span><span class="loader-box"></span><span class="loader-box"></span></span>`
        } else {
            notifText.classList.add("nBarStatus")
            notifText.innerHTML = t
        }
        notifContainer.appendChild(notifText)
    })
    document.body.insertBefore(notifBar, document.body.firstChild);
    port.postMessage({type: "log", payload: "initNotifBar:\n"+notifBar.outerHTML} as Message)
}
/** Shows the passed notification html in the notification bar (which may already exist) */
function showNotif(notif:string[]) {
    let foundExistingBar = document.firstElementChild.querySelector(".nBarOuter.nSingleton")
    if (!foundExistingBar) initNotifBar(notif)
    else {
        let notifBar = foundExistingBar as HTMLDivElement 
        let notifContainer = notifBar.querySelector('div.nBarStatusContainer') as HTMLDivElement
        Array.from(notifContainer.getElementsByClassName("nBarStatus"))
        .forEach(t=>t.remove())
        notif.forEach(t=>{
            let notifText = document.createElement("div");
            if (t == "/-break-/") { // magic string for forced new row in notification
                notifText.classList.add("flexBreak")
                notifText.innerHTML = "&#8205;"
            } else if (t == "/-loader-/") { // magic string for animated loader
                notifText.classList.add("nBarStatus")
                notifText.innerHTML = `<span class="loader"><span class="loader-box"></span><span class="loader-box"></span><span class="loader-box"></span></span>`
            } else {
                notifText.classList.add("nBarStatus")
                notifText.innerHTML = t
            }
            notifContainer.appendChild(notifText)
        })
        notifBar.classList.remove("nBarAnimIn")
        notifBar.classList.remove("nBarAnimColorin")
        void notifBar.offsetWidth
        notifBar.classList.add("nBarAnimColorin")
        port.postMessage({type: "log", payload: "showNotif:\n"+notifBar.outerHTML} as Message)
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
/*----------------------------------------------------
 * © 2021 George Mason University 
 * For further information please contact ott@gmu.edu
------------------------------------------------------*/