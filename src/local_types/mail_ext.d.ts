declare namespace messenger.compose {
    /** A name and email address in the format “Name <email@example.com>”, or just an email address, or recipient object.*/
    type ComposeRecipient = string | {
        /** The ID of a contact or mailing list from the contacts and mailingLists APIs. */
        id: string,
        type: "contact"|"mailingList"
    }
    /** Either a name and email address in the format “Name <email@example.com>”, or just an email address, or array object. */
    type ComposeRecipientList = string | ComposeRecipient[]

    /**
     * Used by various functions to represent the state of a message being composed. Note that functions using this type 
     * may have a partial implementation.
     */
    type ComposeDetails = {
        attachments?: object[]
        bcc?: ComposeRecipientList
        body?: string
        cc?: ComposeRecipientList
        followUpto?: ComposeRecipientList
        /**
         * The ID of an identity from the `accounts` API. The settings from the identity will be used in the composed 
         * message. If `replyTo` is also specified, the `replyTo` property of the identity is overridden. The permission 
         * accountsRead is required to include the identityId.
         */
        identityId?: string
        isPlainText?: boolean
        newsgroups?: string | string[]
        plainTextBody?: string
        replyTo?: ComposeRecipientList
        subject?: string
        to?: ComposeRecipientList
    }
    /**
     * Open a new message compose window replying to a given message. If the provided ComposeDetails object does not 
     * provide ‘body’, ‘plainTextBody’ or ‘isPlainText’, the default compose format of the used/default identity is used.
     * @param messageId The message to reply to, as retrieved using other APIs.
     */
    function beginReply(
        messageId:number,
        replyType?:"replyToSender"|"replyToList"|"replyToAll",
        details?:ComposeDetails) : Promise<browser.tabs.Tab>
    /**
     * Open a new message compose window. If the provided ComposeDetails object does not provide ‘body’, ‘plainTextBody’ or 
     * ‘isPlainText’, the default compose format of the used/default identity is used.
     * @param messageId an existing message or template to edit as a new message (Optional)
     */
    function beginNew(messageId?:number,details?:ComposeDetails) : Promise<browser.tabs.Tab>
    /**
     * Open a new message compose window forwarding a given message. If the provided ComposeDetails object does not provide 
     * ‘body’, ‘plainTextBody’ or ‘isPlainText’, the default compose format of the used/default identity is used.
     * @param messageId The message to forward, as retrieved using other APIs.
     */
    function beginForward(
        messageId: number,
        forwardType?: "forwardInline"|"forwardAsAttachment",
        details?: ComposeDetails)
    /**
     * Fetches the current state of a compose window. Currently only a limited amount of information is available, more will be added in later versions.
     * @param tabId (integer)
     */
    function getComposeDetails(tabId:number) : Promise<ComposeDetails>
    /**
     * Updates the compose window. Specify only fields that you want to change. Currently only the to/cc/bcc/replyTo/followupTo/newsgroups fields and the subject are implemented. It is not possible to change the compose format.
     * @param tabId (integer)
     * @param details (ComposeDetails)
     */
    function setComposeDetails(tabId:number, details:ComposeDetails)

    /** on before send event
    */
    const onBeforeSend: EvListener<(tab:browser.tabs.Tab,details:ComposeDetails)=>{cancel:boolean,details:ComposeDetails}>


    function addListener(listener:(tab:browser.tabs.Tab,details:ComposeDetails)=>{cancel:boolean,details:ComposeDetails})

}


declare namespace messenger.tabs {
    type WindowType = 
        "normal" | "popup" | "panel" | "app" | "devtools" | "addressBook" | 
        "messageCompose" | "messageDisplay"
}

declare namespace messenger.composeScripts {
    function register(composeScriptOptions)
}

declare namespace messenger.messageDisplayScripts {
    function register(messageDisplayScriptOptions)
}

declare namespace messenger.messageDisplay {
    /** message displayed event */
    const onMessageDisplayed: EvListener<(tab:browser.tabs.Tab,message:messages.MessageHeader)=>void>
}

declare namespace messenger.messages {
    /** Basic information about a message */
    type MessageHeader = {
        author?: string
        bccList?: string[]
        ccList?: string[]
        date?: Date
        flagged?: boolean
        /** TODO MailFolder type */
        folder?: object
        /** Added on TB 85 */
        headerMessageId?: string
        id?: number
        junk?: boolean
        junkScore?: number
        read?: boolean
        /** The "To" recipients. */
        recipients?: string[]
        /** The total size of the message in bytes */
        size?: number
        subjects?: string
        tags?: string[]
    }
    /** Represents an email message "part", which could be the whole message */
    type MessagePart = {
        body?: string
        contentType?: string
        /** A object with header name as key and an array of header values as value */
        headers?: object
        /** name of the part, if it is a file    */
        name?: string
        partName?:string
        /** Any sub-parts of this part */
        parts?: MessagePart[]
        size?: number
    }
    /** Returns specified message by ID. */
    function get(messageId: number): Promise<MessageHeader>
    /** Returns a specified message, including all headers and MIME parts. */
    function getFull(messageId: number): Promise<MessagePart>
    /** Returns unmodifed source of a message as a binary string
     *  
     * See ref: https://webextension-api.thunderbird.net/en/latest/messages.html#getraw-messageid
     */
    function getRaw(messageId: number): Promise<string>
}