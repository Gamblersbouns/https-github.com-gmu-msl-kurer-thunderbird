/*----------------------------------------------------
 * © 2021 George Mason University
 * For further information please contact ott@gmu.edu
------------------------------------------------------*/
let mainForm:HTMLFormElement

let cert:HTMLTextAreaElement
let email:HTMLInputElement

let statusBar: HTMLDivElement
let autoEncrypt: HTMLInputElement
let sendWarning: HTMLInputElement
let autoSign: HTMLInputElement
let replyEncr: HTMLInputElement
let sendStats: HTMLInputElement

let telemetryMsg: HTMLDivElement
let userStudyModal: HTMLDivElement
let confirmDeclineModal: HTMLDivElement

let sepPrivKeySwitch: HTMLInputElement
let privKeyBlock: HTMLDivElement
let privKeyText: HTMLHeadingElement
let privKeySignBlock: HTMLDivElement
let dohServer: HTMLInputElement

window.onload = () => {
    mainForm= <HTMLFormElement>document.getElementById("mainForm")

    cert = <HTMLTextAreaElement>document.getElementById("cert")
    email = <HTMLInputElement>document.getElementById("email")

    statusBar = <HTMLDivElement>document.getElementById("statusbar")

    autoEncrypt = <HTMLInputElement>document.getElementById("opt_autoEncrypt")
    sendWarning = <HTMLInputElement>document.getElementById("opt_sendWarning")
    autoSign = <HTMLInputElement>document.getElementById("opt_autoSign")
    replyEncr = <HTMLInputElement>document.getElementById("opt_replyEncr")
    sendStats = <HTMLInputElement>document.getElementById("optSendStats")
    dohServer = <HTMLInputElement>document.getElementById("doh_server")

    sepPrivKeySwitch = <HTMLInputElement>document.getElementById("opt_seperateKeys")
    sepPrivKeySwitch.onclick = ()=>{ handleDualPrivKeySwitch(200) }
    handleDualPrivKeySwitch(0)

    privKeyBlock = <HTMLDivElement>document.getElementById("privKey_section")
    privKeyText = <HTMLHeadingElement>document.getElementById("privKey_message")
    privKeySignBlock = <HTMLDivElement>document.getElementById("privKeySign_section")

    // add open pitch modal functionality to the bottom telemetry link
    telemetryMsg = <HTMLDivElement>document.getElementById("telemetry_msg")
    userStudyModal = <HTMLDivElement>document.getElementById("user_study_modal")
    confirmDeclineModal = <HTMLDivElement>document.getElementById("confirm_decline_modal")


    telemetryMsg.onclick = ()=>{ // open userstudy modal by clicking on message
        userStudyModal.style.display = "block"
    }
    window.onclick = event => { //close userstudy modal by clicking away
        if (event.target == userStudyModal) {
            $(userStudyModal).fadeOut()
        }
    }

    document.getElementById("confirm_no_btn").onclick = ()=>{
        $(confirmDeclineModal).fadeOut()
    }
    // the confirm quit user study button
    document.getElementById("confirm_yes_btn").onclick = ()=>{

        $(userStudyModal).fadeOut()
        $(confirmDeclineModal).fadeOut()
    }
    $('#privKey').on('change', ()=>{handleKeyAdded('privKey','privateKey')})
    $('#privKeySign').on('change', ()=>{handleKeyAdded('privKeySign','signingKey')})

    $('#privKeyPasscode').on('change',()=>{
        $('#privKey').trigger('change')
    })
    $('#privKeySignPasscode').on('change',()=>{
        $('#privKeySign').trigger('change')
    })
    updateUstudAccept()
    /* Save options of form submit*/
    mainForm.onsubmit = onSaveOpts

    /* Load options on form reset */
    mainForm.onreset = ev => {
        browser.storage.local.get({'options':null})
        .then((result:Options)=>{
            if (!result.options) {showStatus(`No previously saved options found`); return}
            let options = result.options
            if (options.email!==undefined) {
                email.value = email.innerHTML = options.email
            }
            if (options.privateKey!==undefined) {
                privKeyBlock.querySelector(".func_status_msg").innerHTML = "<span class='color-pos-faint'>The last saved key is currently active</span><br>You can overwrite by selecting a new key"
            }
            if (options.signingKey!==undefined) {
                privKeySignBlock.querySelector(".func_status_msg").innerHTML = "<span class='color-pos-faint'>The last saved key is currently active</span><br>You can overwrite by selecting a new key"
            }
            if (options.dualKeyMode!=null && sepPrivKeySwitch.checked != options.dualKeyMode )  sepPrivKeySwitch.click()
            if (options.autoEncrypt!=null && autoEncrypt.checked != options.autoEncrypt )  autoEncrypt.click()
            if (options.warningUnsecure!=null && sendWarning.checked != options.warningUnsecure ) sendWarning.click()
            if (options.autoSign!=null && autoSign.checked != options.autoSign) autoSign.click()
            if (options.dnsRslvr!=null && options.dnsRslvr!="") dohServer.value = options.dnsRslvr
            showStatus( /*html*/`<span style="color:#CBEFB6">Loaded</span> successfully`)
        }, reason=>{showStatus(/*html*/`<span style="color:#D74E09">Error</span> on load: ${reason}`)} )
        ev.preventDefault()
    }

    mainForm.dispatchEvent(new Event('reset'))
    toggleSwitchAnim()
}

/** When the save button is pressed: save options to storage, process telemetry work as need necessary */
async function onSaveOpts(ev:Event) {

    // update whatever options are already there
    let optToSet:Options = (await browser.storage.local.get({'options':{}}))
    optToSet.options.privateKeyPasscode = (privKeyBlock.querySelector("input.func_passcode") as HTMLInputElement).value
    optToSet.options.signingKeyPasscode = (privKeySignBlock.querySelector("input.func_passcode") as HTMLInputElement).value
    optToSet.options.cert = cert.value.length>0 ? cert.value : null
    optToSet.options.email = email.value.length>0 ? email.value : null
    // set toggle options
    optToSet.options.dualKeyMode = !!sepPrivKeySwitch.checked
    optToSet.options.autoEncrypt = !!autoEncrypt.checked
    optToSet.options.warningUnsecure = !!sendWarning.checked
    optToSet.options.autoSign = !!autoSign.checked
    optToSet.options.replyEncr = !!replyEncr.checked
    optToSet.options.dnsRslvr = dohServer.value

    try{ // set the new options
        await browser.storage.local.set(optToSet)
    } catch(e) {
        showStatus(/*html*/`<span style="color:#D74E09">Error</span> on save: ${e}`)
    }
    showStatus(/*html*/`<span style="color:#CBEFB6">Saved</span> successfully`)
    sendTelem()
    // if send stats is checked, send the stats we care about
    ev.preventDefault()
}
async function updateKeyText(id:string,optName:string) {
    let result = await browser.storage.local.get({'options':{}})
    if (result.options[optName]) {
        document.getElementById(id).parentElement.querySelector(".func_status_msg").innerHTML = "<span class='color-pos-faint'>Previous key still active</span><br>You can overwrite by selecting a new key"
    }
}
/** Handler for when user uploads key file, given id to respective select */
async function handleKeyAdded(id:string,optName:string) {
    const fileToBase64 = file => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        // return the actual base64 string without headers
        reader.onload = () => {
            const idx = (reader.result as string).indexOf("base64,")
            resolve((reader.result as string).substring(idx+7));
        }
        reader.onerror = error => reject(error);
    });
    let input = document.getElementById(id) as HTMLInputElement
    let passcode = input.parentElement.parentElement.querySelector('input.func_passcode') as HTMLInputElement

    const fileList = input.files
    if (fileList.length != 1) { // cancelled file upload
        await updateKeyText(id,optName)
        return
    } else { // exactly one file uploaded
        let keyContent: any = await fileToBase64(fileList[0])
        console.debug('[DEBUG] options.js : handleKeyAdded: keyContent : ', keyContent)
        let response = await browser.runtime.sendMessage({type:'util',util:'procKeyFile',base64:keyContent}as Message)
        console.debug('[DEBUG] options.js : handleKeyAdded: response')
        console.dir(response)
        if (response.pem == null) {
            document.getElementById(id).parentElement.querySelector(".func_status_msg").innerHTML = "<span class='color-neg-faint'>Could not parse key</span><br>Ensure the correct format (pem or p12)"
            // try it with the passcode this time
            response = await browser.runtime.sendMessage({type:'util',util:'procKeyFile',base64:keyContent,pw:passcode.value} as Message)
        } else if (response.pem != null){ // successful conversion
            document.getElementById(id).parentElement.querySelector(".func_status_msg").innerHTML = `<span class='color-pos-faint'>Successfully imported key</span><br>Format: ${response.desc}`
            // store pem
            let opt = await browser.storage.local.get({'options':{}})
            opt.options[optName] = response.pem
            opt.options[optName+'Passcode'] = passcode.value
            await browser.storage.local.set(opt)
        }
    }
}
/** Grabs values currently set values from storage and creates telemetry packet if the userStudy flag is true*/
async function sendTelem() {
    let s0 = await browser.storage.local.get({'userStudy':false})
    if (!s0.userStudy) return // dont take any telemetry action if they user does not consent
    let telem:KurerTelemObj = {}
    let s1 = await browser.storage.local.get({'options':null})
    if (s1.options === null) return; // dont even continue if there is nothing. This should never happen outside of errors in saving
    let options = s1 as Options
    if (options.options.autoEncrypt!==null) telem.autoEncr = !!options.options.autoEncrypt
    if (options.options.autoSign!==null) telem.autoSign = !!options.options.autoSign
    if (options.options.dualKeyMode!==null) telem.seperateSignDecrKey = !!options.options.dualKeyMode
    if (options.options.warningUnsecure!==null) telem.warnEncrFail = !!options.options.warningUnsecure
    if (options.options.replyEncr!==null) telem.replyEncr = !!options.options.replyEncr
    if (options.options.dnsRslvr!==null) { // check against public doh server list
        let value = options.options.dnsRslvr
        if (value=="") value = 'cloudflare-dns.com/dns-query' // apply default for empty value
        let split = value.split('/')
        let domain = split[0]
        for (let i=1; i<split.length; i++) {
            if (!domain.includes('.')) domain = split[i]
        } domain = domain.toLowerCase()
        console.debug("domain",domain)
        console.debug("split",split)
        console.dir(dohServers)
        telem.recResolver = 'private'
        for (let i=0; i<dohServers.length; i++) {
            if (dohServers[i].toLowerCase() == domain) telem.recResolver = value
        }
    }
    let s2 = await browser.storage.local.get({'surveyOccupation':null})
    if (s2.surveyOccupation !== null) { // survey occupation question
        telem.userSurveyOccupation = s2.surveyOccupation
    }
    let s3 = await browser.storage.local.get({'surveyCountry':null})
    if (s3.surveyCountry !== null) { // survey country question
        telem.userSurveyCountryOfOrigin = s3.surveyCountry
    }
    let s4 = await browser.storage.local.get({'surveyAge':null})
    if (s4.surveyAge !== null) { // survey age question
        let temp = (s4.surveyAge as string).split('-')
        let age:[number, number] = [-1,-1]
        age[0] = parseInt(temp[0])
        age[1] = parseInt(temp[1])
        telem.userSurveyAgeRange = age
    }
    // meta telem: client and version
    telem.client = 'TB'
    telem.version = browser.runtime.getManifest().version

    // finally add id: first check if we have one stored
    let s5 = await browser.storage.local.get({'clientId':null})
    if (s5.clientId === null) { // we need to generate a new one
        console.log('[DEBUG] options.ts : sendTelem : clientID retrieved: ')
        console.dir(s5)
        let newHash = await browser.runtime.sendMessage({type: "util", util:"sha256", seed:(new Date()).toString()+(Math.random()*1000).toString()} as Message)
        telem.id = newHash
    } else {
        telem.id = s5.clientId
    }
    // finally post the data
    $.post({url:'https://kurer.daneportal.net/telem', data:{
        telem: JSON.stringify(telem)
    }}).then(data=>{ // if we get a response
        if (data.id) browser.storage.local.set({'clientId':data.id})
        if (data.secret) browser.storage.local.set({'delKey':data.secret})
    }).always(r=>{
        console.log('options.js: sendTelem(): post always')
        console.dir(r)
    })
}
// opt out of user study confirmation button pressed
async function onclickOptOutConfirm() {
    let yesBtn = document.getElementById('confirm_yes_btn') as HTMLButtonElement
    $(yesBtn).off('click')
    let revoke = document.getElementById('opt_remove_all_data') as HTMLInputElement
    revoke.disabled = true
    if (revoke.checked) {
        // get stored client id and delete key values
        let id = (await browser.storage.local.get({'clientId':""})).clientId
        let secret = (await browser.storage.local.get({'delKey':""})).delKey
        // do revoke telemetry
        $.post({url:'https://kurer.daneportal.net/telem', data:{
            telem: JSON.stringify({
                id: id,
                mode: 'delete',
                secret: secret
            })
        }}).always(r=>{console.log('onClickOptOutConfirm():'); console.dir(r);})
    }
    await browser.storage.local.set({'userStudy':false})
    $('#user_study_modal').fadeOut()
    $('#confirm_decline_modal').fadeOut('slow',()=>{
        browser.storage.local.set({'userStudy':false})
        .then( ()=>{updateUstudAccept() })
        .then(()=>{showStatus(`<span class="color-neg-faint">Cancelled</span> user study opt-in`)} ) })

}
// update buttons/text according to if the user has accepted the user study or not
async function updateUstudAccept() {
    let result = await browser.storage.local.get({'userStudy':false})
    if (result && result.userStudy) { //accepted telem
        // change message
        $("#ustud_msg").html('<span class="color-pos">You chose to opt-in to anonymous data sharing, thanks!</span>')
        // change buttons
        $("#ustud_yes_btn").text('OK').off('click').on('click',e=>{$('#user_study_modal').fadeOut()}).prop('disabled',false)
        $("#ustud_no_btn").text('Cancel').off('click').on('click',e=>{$("#confirm_decline_modal").css('display','block')})
        // show survey
        $("#ustud_survey_section").fadeIn().slideDown('slow')
        //update checkbox
        $('#optSendStats').prop('checked',true)
        $('#telemetry_msg').addClass('color-pos-faint')
        $('#opt_remove_all_data').prop('disabled',false)
        $('#opt_remove_all_data').prop('checked',false)
        $('#confirm_yes_btn').on('click',onclickOptOutConfirm)


    } else { // declined telem
        // change message
        $("#ustud_msg").html('<span style="font-size:larger" class="color-pos-faint">Would you like to opt-in?</span>')
        // change buttons
        $("#ustud_no_btn").text('No Thanks').off('click').on('click',e=>{$('#user_study_modal').fadeOut()})
        $("#ustud_yes_btn").text('Accept').off('click').on('click',e=>{
            $(this).prop('disabled',true)
            browser.storage.local.set({'userStudy':true}).then(()=>{ updateUstudAccept() })
            .then(()=>{showStatus(`<span class="color-pos-faint">Accepted</span> user study opt-in`)})
        })
        // hide survey area
        $("#ustud_survey_section").fadeOut().slideUp('slow',()=>{
            // remove saved values for user survey
            browser.storage.local.remove(['surveyAge','surveyCountry','surveyOccupation'])
            .then(()=>{
                initSurvey()
            }) // reinitialize the survey fields
        })
        // update checkbox
        $('#optSendStats').prop('checked',false)
        $('#telemetry_msg').removeClass('color-pos-faint')
    }
}
async function handleDualPrivKeySwitch(delay: number) {
    let sepKeys = sepPrivKeySwitch.checked
    await new Promise(r => setTimeout(r, delay));
    if (sepKeys) {
        privKeyText.textContent = "Key for decrypting"
        privKeySignBlock.style.display = "block"
    } else {
        privKeyText.textContent = "Key for decrypting and signing"
        $(privKeySignBlock).slideUp()
    }
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
/** list of country names and codes */
var countries: {text: string, id: string}[] = []
/** list of occupation choices */
var occupations: {text: string, id: string}[] = []
/** list of age-range choices */
var ages: {text: string, id: string}[] = []
/** list of public doh servers domain names/ip addresses. Make sure to only compare domain names (not path part, etc) */
var dohServers: string[]

/** TEMPORARY On Startup tests
 * TODO:REMOVE */
// test sha256
// const testSeed = "testSeed"
// browser.runtime.sendMessage({type:"util", util:"sha256", seed:testSeed} as Message)
// .then( digest=>{
//     const logMsg = `[options.js] tried sha256 of "${testSeed}" got digest "${digest}"`
//     browser.runtime.sendMessage({type:"util", util:"log", log:logMsg})
// } )

async function loadRes() {
    let clist = (await (await fetch('/res/countryList.json')).text())
    countries = JSON.parse(clist)
    let olist = (await (await fetch('/res/occupations.txt')).text()).split(',')
    olist.forEach(e=>{ occupations.push({text: e, id: e}) })
    let alist = (await (await fetch('/res/ages.txt')).text()).split(',')
    alist.forEach(e=>{ ages.push({text: e, id: e}) })
    dohServers = (await (await fetch('/res/public-resolvers-proc.txt')).text()).split(',')
}
/** Set up dynamic select lists for the user survey */
async function initSurvey() {
    ($('#ust_country') as any).select2({data: countries});
    ($('#ust_occupation') as any).select2({data: occupations});
    ($('#ust_age') as any).select2({data: ages});

    let sur = await browser.storage.local.get({'surveyAge':"",'surveyCountry':"",'surveyOccupation':""})
    if (sur.surveyAge) {($('#ust_age') as any).val(sur.surveyAge); ($('#ust_age') as any).trigger('change')}
    if (sur.surveyCountry) {($('#ust_country') as any).val(sur.surveyCountry); ($('#ust_country') as any).trigger('change')}
    // handle clicking on "other" option
    function occuptionUpdate(ev) {
        let input = $("#ust_occupation_other")
        if (ev.target.value == "other") {
            input.prop('disabled',false).fadeTo('fast',1)
            input.off("input").on("input",e=>{
                let trimmed = $("#ust_occupation_other").val() as string
                if (trimmed.length > 50) trimmed = trimmed.slice(0,50)
                browser.storage.local.set({'surveyOccupation': `_other:${trimmed}`})
            })
            $("#ust_occupation_other").trigger('input')
        } else {
            input.prop('disabled',true).fadeTo('fast',.10)
            input.off("input")
            browser.storage.local.set({'surveyOccupation': $('#ust_occupation').val()})
        }
    }
    // save values when selected
    $('#ust_occupation').on('change',occuptionUpdate) // show/hide the "other" text field when selecting options
    $('#ust_country').on('change',e=>{ browser.storage.local.set({'surveyCountry': $('#ust_country').val()}) })
    $('#ust_age').on('change',e=>{ browser.storage.local.set({'surveyAge': $('#ust_age').val()}) })

    if (sur.surveyOccupation) {
        if (sur.surveyOccupation.toString().startsWith('_other:')) { // if its the other setting, get the value
            ($('#ust_occupation') as any).val("other").trigger('change');
            $("#ust_occupation_other").show().val(sur.surveyOccupation.toString().slice(7))
        } else {
            ($('#ust_occupation') as any).val(sur.surveyOccupation); ($('#ust_occupation') as any).trigger('change')
        }
    }
}

$(async function() {
    //load
    // load select2
    await browser.storage.local.get({'clientId':null})
    await loadRes()
    await initSurvey()


})

async function testRunStartup() {
    await browser.storage.local.get({'surveyAge':null})
}

/*----------------------------------------------------
 * © 2021 George Mason University
 * For further information please contact ott@gmu.edu
------------------------------------------------------*/