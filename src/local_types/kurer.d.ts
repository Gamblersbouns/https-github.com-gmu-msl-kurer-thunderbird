/*----------------------------------------------------
 * © 2021 George Mason University
 * For further information please contact ott@gmu.edu
------------------------------------------------------*/
/* Types specific to our extension-defined objects */

/** The object format of our stored options data */
type Options = {
    options?: {
        /** PEM format of private key file loaded by user in options */
        privateKey?: string
        /** If True, consider "privateKey" as only for decrypting and use "signingKey" for signing -- otherwise "privateKey" is to be used for both*/
        privateKeyPasscode?: string
        dualKeyMode?: boolean
        /** Key used for signing if dualKeyMode is set */
        signingKey?: string
        signingKeyPasscode?: string
        /** TODO: handle key passwords */
        /** User's email address when sending - used for signing */
        email?: string
        /** Cert used when generating signiture */
        cert?: string
        /** Toggle options for auto encrypt/sign */
        autoEncrypt?: boolean
        warningUnsecure?: boolean
        /** The sign-on-send toggle defaults to this value */
        autoSign?: boolean
        /** The option to preserve the secure quoted message on reply (decrypt reply quote if true)*/
        replyEncr?: boolean
        /** Non-default DoH resolver set in options */
        dnsRslvr?: string
    }
}
/** Valid message tags used in runtime background script communication */
type Message =
    {type: "getOptions"}
    | {type: "sendOptions", payload: Options}
    | {type: "encrypt", tabId?: number}
    | {type: "sign"}
    | {type: "decrypt", ciphertext: string}
    | {type: "log", payload: any}
    | {type: "dir", payload: any}
    | {type: "notif", payload: string[], color?: 'pos' | 'mid' | 'neg', delay?: number}
    | {type: "replace", payload: string, delay?:number}
    | {type: "ping"}
    | { type: "get", query:"composeTabId" }
    | { type: "reply", query: "composeTabId", tabId: number }
    | { type: "get", query: "composeSign", tabId: number}
    | { type: "reply", query: "composeSign", signed: boolean}
    | { type: "action", action: "composeSetSigned", signed: boolean, tabId: number }
    | { type: "action", action: "composeSendEncrypt", tabId: number }
    | { type: "util", util: "sha256", seed: string } // returns a digest string
    | { type: "util", util: "verboseLogs" } // returns a boolean
    | { type: "util", util: "log", level?:"DEBUG"|"INFO"|"WARN"|"ERROR", log: string}
    | { type: "util", util: "procKeyFile", base64:string, pw:string|null} // returns { "pem":string, "desc":string }
    // sends log message to background script to be printed to console -- level defaults to "DEBUG"
/**
 * The data format of the telemtry sent on save when the user allows it
 */
type KurerTelemObj = {
    id?: string
    mode?: 'delete'
    secret?: string
    client?: "TB" | "OL"
    version?: string
    autoEncr?: boolean
    autoSign?: boolean
    warnEncrFail?: boolean
    replyEncr?: boolean
    recResolver?: string
    seperateSignDecrKey?: boolean
    userSurveyOccupation?: string
    userSurveyAgeRange?: [number, number] // integer range of ages inclusive
    userSurveyCountryOfOrigin?: string
}
/*----------------------------------------------------
 * © 2021 George Mason University
 * For further information please contact ott@gmu.edu
------------------------------------------------------*/