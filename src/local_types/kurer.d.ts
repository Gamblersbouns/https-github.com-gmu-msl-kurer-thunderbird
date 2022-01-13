/*----------------------------------------------------
 * © 2021 George Mason University 
 * For further information please contact ott@gmu.edu
------------------------------------------------------*/
/* Types specific to our extension-defined objects */

/** The object format of our stored options data */
type Options = {
    options: {
        /** Unencrypted private key (temp. testing use) */
        privateKey?: string
        /** User's email address when sending */
        email?: string
        /** Cert used when generating signiture */
        cert?: string
        /** Array of cached name-cert associations */
        cache?: {
            name: string
            cert: string
        }[]
        /** Toggle options for auto encrypt/sign */
        autoEncrypt?: boolean
        warningUnsecure?: boolean
        /** The sign-on-send toggle defaults to this value */
        autoSign?: boolean
        /** The option to preserve the secure quoted message on reply (decrypt reply quote if true)*/
        replyEncr?: boolean
        /** Random key generated on first time saving options */
        randId?: string
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
/*----------------------------------------------------
 * © 2021 George Mason University 
 * For further information please contact ott@gmu.edu
------------------------------------------------------*/