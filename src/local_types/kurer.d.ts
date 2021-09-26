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
        autoSign?: boolean
    }
}
/** Valid message tags used in runtime background script communication */
type Message = 
    {type: "getOptions"} |
    {type: "sendOptions", payload: Options} |
    {type: "encrypt", tabId?: number} |
    {type: "sign"} |
    {type: "decrypt", ciphertext: string} |
    {type: "log", payload: any} |
    {type: "dir", payload: any} |
    {type: "notif", payload: string[], color?: 'pos' | 'mid' | 'neg', delay?: number} |
    {type: "replace", payload: string, delay?:number} |
    {type: "ping"}
