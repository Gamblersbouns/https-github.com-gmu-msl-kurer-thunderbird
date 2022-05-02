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
        /** Added in TB 88 */
        from?: ComposeRecipient

        /**
         * The ID of an identity from the `accounts` API. The settings from the identity will be used in the composed
         * message. If `replyTo` is also specified, the `replyTo` property of the identity is overridden. The permission
         * `accountsRead` is required to include the identityId.
         */
        identityId?: string
        isPlainText?: boolean
        newsgroups?: string | string[]
        plainTextBody?: string
        replyTo?: ComposeRecipientList
        subject?: string
        to?: ComposeRecipientList
        /** read only (added in TB 88) */
        type?: 'draft' | 'new' | 'redirect' | 'reply' | 'forward'
    }
    /** Represents an attachment in a message being composed */
    type ComposeAttachment = {
        id:number,
        name: string,
        size: number,
        getFile: ()=>File
    }
    /** Adds an attachment to the message being composed in the specified tab */
    function addAttachment(
        tabId:number,
        data: {
            file: File
            name?: string
        }
    ) : Promise<ComposeAttachment>
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
    /** Sends the message currently being composed under the given tab */
    function sendMessage(tabId:number, options?:{mode: "default"|"sendNow"|"sendLater"} ) : Promise<boolean>
    /** on before send event
    */
    const onBeforeSend: EvListener<(tab:browser.tabs.Tab,details:ComposeDetails)=>{cancel:boolean,details:ComposeDetails} | Promise<any> >

}


declare namespace messenger.tabs {
    type WindowType =
        "normal" | "popup" | "panel" | "app" | "devtools" | "addressBook" |
        "messageCompose" | "messageDisplay"
    type Tab = {
        active: boolean,
        highlighted: boolean,
        index: number,
        height?: number,
        width?: number,
        id?: number
        mailTab?: boolean,
        status?: 'loading' | 'complete',
        title?: string,
        type?: 'addressBook'|'calendar'|'calendarEvent'|'calendarTast'|'chat'|'content'|'mail'|'messageCompose'|'messageDisplay'|'special'|'tasks',
        url?: string,
        windowId?: number
    }
}

declare namespace messenger.composeScripts {
    function register(composeScriptOptions)
}
declare namespace messenger.composeAction {
    /** Has tabId or windowId or niether (for global) but not both */
    type Details = {tabId?: number, windowId?:undefined} | {windowId?:number, tabId?:undefined}
    /** color represented by RGBA values 0-255 */
    type ColorArray = [number, number, number, number]
    /** Sets the title of the composeAction. This shows up in the tooltop and the label.
     * Defaults to the add-on name. */
    function setTitle(details:{title:string|null}&Details)
    /** Gets the title of the composeAction */
    function getTitle(details:Details) : Promise<string>

    function setLabel(details:{label:string|null}&Details)
    function getLabel(details:Details) : Promise<string>

    function setIcon(details: {
        imageData?:ImageData,
        /** relative path to icon */
        path?:string
    } & Details)

    /** Sets the badge text for the composeAction. The badge is displayed on top of the icon */
    function setBadgeText(details: {
        /** Can fit ~4 characters in the badge */
        text:string|null
    } & Details)
    function setBadgeBackgroundColor(details: {
        /**css-string or 0-255 rgba array*/
        color: string | ColorArray
    } & Details)
    function getBadgeBackgroundColor(details: Details): Promise<ColorArray>

    function enable(tabId?: number)

    function disable(tabId?: number)

    function isEnabled(details: Details): Promise<boolean>


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
    /** Represents an attachment in a message */
    type Attachment = {
        contentType: string,
        name: string,
        partName: string,
        size: number
    }
    /** Represents an email message "part", which could be the whole message */
    type MessagePart = {
        body?: string
        contentType?: string
        /** A object with header name as key and an array of header values as value */
        headers?: any
        /** name of the part, if it is a file    */
        name?: string
        partName?:string
        /** Any sub-parts of this part */
        parts?: MessagePart[]
        size?: number
    }
    /** List all of the attachments of a message */
    function listAttachments(messageId:number): Attachment[]
    /** Gets the content of an attachment as a DOM File object */
    function getAttachmentFile(messageId:number, partName:string): File
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