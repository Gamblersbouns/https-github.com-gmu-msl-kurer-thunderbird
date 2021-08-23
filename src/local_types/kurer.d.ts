/* Types specific to our extension-defined objects */

/** The object format of our stored options data */
type Options = {
    options: {
        /** Unencrypted private key (temp. testing use) */
        privateKey?: string
        /** Array of cached name-cert associations */
        cache?: {
            name: string
            cert: string
        }[]
        /** Toggle options for auto encrypt/decrypt/sign */
        autoDecrypt?: boolean
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
    {type: "decrypt", ciphertext: string} |
    {type: "log", payload: any} |
    {type: "dir", payload: any} |
    {type: "notif", payload: string[], color?: 'pos' | 'mid' | 'neg', delay?: number}
