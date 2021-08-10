/** 
 * This links up all crypto dependencies and contains our custom-built DANE-S/MIME helper functions. 
 */

//const WebCrypto = require("@peculiar/webcrypto").Crypto // unneeded if we assume browser compat.
import { Convert } from "pvtsutils"
//const MimeBuilder = require("emailjs-mime-builder") 
import smimeParse from "emailjs-mime-parser" 
import * as asn1js from "asn1js"
import * as pkijs from "pkijs"
import { base64Encode, quotedPrintableEncode, foldLines, parseHeaderValue } from 'emailjs-mime-codec'
import { detectMimeType } from 'emailjs-mime-types'
import { convertAddresses, parseAddresses, encodeHeaderValue, normalizeHeaderKey, 
    generateBoundary, isPlainText, buildHeaderValue } from 'emailjs-mime-builder/dist/utils'  
import { PemConverter } from "@peculiar/x509"

/** Returns Base64 array from ascii PEM format */
function decodePem(pem:string) {
    const pattern = /-{5}BEGIN [A-Z0-9 ]+-{5}([a-zA-Z0-9=+/\n\r]+)-{5}END [A-Z0-9 ]+-{5}/g;
    const res = [];
    let matches = null;
    while (matches = pattern.exec(pem)) {
        const base64 = matches[1]
            .replace(/\r/g, "")
            .replace(/\n/g, "");
        res.push(Convert.FromBase64(base64));
    }
    return res;
}

/** Simply return the inner text of a string representing html */
function decodeHtml(html: string): string {
    var txt = document.createElement("textarea");
    txt.innerHTML = html;
    return txt.value;
}
/** Convert a string into html compatible string */
function encodeHtml(str: string): string {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Set crypto engine
const cryptoEngine = crypto;
const engineName = "WebCrypto";
pkijs.setEngine(
  engineName,
  cryptoEngine,
  // subtle context
  new pkijs.CryptoEngine({ name: engineName, crypto: cryptoEngine, subtle: cryptoEngine.subtle })
);

/**
 * Adapted from PKI.js' SMIMEEncryptionExample
 * @returns {string} encrypted string
 * @param {string} text string to encrypt
 * @param {string} certificatePem public certificate to encrypt with in PEM format
 * @param {string} oaepHashAlgo algorithm to hash the text with (defaults to SHA-256)
 * @param {string} encryptionAlgo algorithm to encrypt the text with ("AES-CBC" or "AES-GCM")
 * @param {Number} length length to encrypt the text to (default 128)
 */
export async function smimeEncrypt(
  text: string,
  certificatePem: string,
  oaepHashAlgo: string = "SHA-256",
  encryptionAlgo: string = "AES-CBC",
  length: Number = 128
): Promise<string> {
  // Decode input certificate
  try {
    const asn1 = asn1js.fromBER(decodePem(certificatePem)[0]);
    const certSimpl = new pkijs.Certificate({ schema: asn1.result });

    const cmsEnveloped = new pkijs.EnvelopedData();

    cmsEnveloped.addRecipientByCertificate(certSimpl, { oaepHashAlgorithm: oaepHashAlgo });

    await cmsEnveloped.encrypt({ name: encryptionAlgo, length: length }, Convert.FromUtf8String(text));

    const cmsContentSimpl = new pkijs.ContentInfo();
    cmsContentSimpl.contentType = "1.2.840.113549.1.7.3";
    cmsContentSimpl.content = cmsEnveloped.toSchema();

    const schema = cmsContentSimpl.toSchema();
    const ber = schema.toBER(false);

    // Insert enveloped data into new Mime message
    var mimeBuilder = new MimeNode("application/pkcs7-mime; name=smime.p7m; smime-type=enveloped-data; charset=binary")
    mimeBuilder
        .setHeader("content-description", "Enveloped Data")
        .setHeader("content-disposition", "attachment; filename=smime.p7m")
        .setHeader("content-transfer-encoding", "base64")
        .setContent(new Uint8Array(ber));
    mimeBuilder.setHeader("from", "sender@example.com");
    mimeBuilder.setHeader("to", "recipient@example.com");
    mimeBuilder.setHeader("subject", "Example S/MIME encrypted message");
    return mimeBuilder.build();
  } catch(error) {
    console.error(error);
  }
}
/**
 * Adapted from PKI.js' SMIMEEncryptionExample
 * @returns {string} decrypted string
 * @param {string} text string to decrypt
 * @param {string} privateKeyPem user's private key to decrypt with in PEM format
 * @param {string} certificatePem user's public certificate to decrypt with in PEM format
 */
export async function smimeDecrypt(text: string, privateKeyPem: string, certificatePem: string): Promise<string> {
  // Decode input certificate
  let asn1 = asn1js.fromBER(decodePem(certificatePem)[0]);
  const certSimpl = new pkijs.Certificate({ schema: asn1.result });

  // Decode input private key
  const privateKeyBuffer = decodePem(privateKeyPem)[0];

  // Parse S/MIME message to get CMS enveloped content
  try {
    const parser:any = smimeParse(text);

    // Make all CMS data
    asn1 = asn1js.fromBER(parser.content.buffer);
    if (asn1.offset === -1) {
      alert('Unable to parse your data. Please check you have "Content-Type: charset=binary" in your S/MIME message');
      return;
    }

    const cmsContentSimpl = new pkijs.ContentInfo({ schema: asn1.result });
    const cmsEnvelopedSimpl = new pkijs.EnvelopedData({ schema: cmsContentSimpl.content });

    const message = await cmsEnvelopedSimpl.decrypt(0, {
      recipientCertificate: certSimpl,
      recipientPrivateKey: privateKeyBuffer,
    });

    return Convert.ToUtf8String(message);
  } catch (err) {
    // Not an S/MIME message
    throw err;
  }
}

/**
 * Adapted from PKI.js' CMSSignedComplexExample
 * @returns {String} signed string
 * @param {String} text string to sign
 * @param {String} privateKeyPem user's private key to sign with in PEM format
 * @param {String} certificatePem user's public cert to sign with in PEM format
 */
 export async function smimeSign(
  text: string,
  privateKeyPem: string,
  certificatePem: string,
  signAlgo = "RSASSA-PKCS1-v1_5",
  hashAlgo = "SHA-256",
  modulusLength = 2048,
  addExt = false,
  detachedSignature = true
): Promise<string> {
  const alg = {
    name: signAlgo,
    hash: hashAlgo,
    publicExponent: new Uint8Array([1, 0, 1]),
    modulusLength: modulusLength,
  };

  // Decode input certificate
  const asn1 = asn1js.fromBER(decodePem(certificatePem)[0]);
  const certSimpl = new pkijs.Certificate({ schema: asn1.result });

  // Import key
  const pkcs8 = decodePem(privateKeyPem)[0];
  const key = await crypto.subtle.importKey("pkcs8", pkcs8, alg, false, ["sign"]);

  const cmsSigned = new pkijs.SignedData({
    version: 1,
    encapContentInfo: new pkijs.EncapsulatedContentInfo({
      eContentType: "1.2.840.113549.1.7.1", // "data" content type
      eContent: new asn1js.OctetString({ valueHex: Convert.FromUtf8String(text) }),
    }),
    signerInfos: [
      new pkijs.SignerInfo({
        version: 1,
        sid: new pkijs.IssuerAndSerialNumber({
          issuer: certSimpl.issuer,
          serialNumber: certSimpl.serialNumber,
        }),
      }),
    ],
    certificates: [certSimpl],
  });

  await cmsSigned.sign(key, 0, hashAlgo);

  const cmsContentSimpl = new pkijs.ContentInfo();
  cmsContentSimpl.contentType = "1.2.840.113549.1.7.2";
  cmsContentSimpl.content = cmsSigned.toSchema();

  const schema = cmsContentSimpl.toSchema();
  const ber = schema.toBER(false);

  // Insert enveloped data into new Mime message
  const mimeBuilder = new MimeNode("application/pkcs7-mime; name=smime.p7m; smime-type=signed-data;")
    .setHeader("content-description", "Signed Data")
    .setHeader("content-disposition", "attachment; filename=smime.p7m")
    .setHeader("content-transfer-encoding", "base64")
    .setContent(new Uint8Array(ber));
  mimeBuilder.setHeader("from", "sender@example.com");
  mimeBuilder.setHeader("to", "recipient@example.com");
  mimeBuilder.setHeader("subject", "Example S/MIME signed message");

  return mimeBuilder.build();
}

export async function smimeSign2(
  text,
  privateKeyPem,
  certificatePem,
  signAlgo = "RSASSA-PKCS1-v1_5",
  hashAlgo = "SHA-256",
  modulusLength = 2048,
  addExt = false,
  detachedSignature = true
) {
  const alg = {
    name: signAlgo,
    hash: hashAlgo,
    publicExponent: new Uint8Array([1, 0, 1]),
    modulusLength: modulusLength,
  };

  // Decode input certificate
  const asn1 = asn1js.fromBER(decodePem(certificatePem)[0]);
  const certSimpl = new pkijs.Certificate({ schema: asn1.result });

  // Import key
  const pkcs8 = decodePem(privateKeyPem)[0];
  const key = await crypto.subtle.importKey("pkcs8", pkcs8, alg, false, ["sign"]);

  const cmsSigned = new pkijs.SignedData({
    version: 1,
    encapContentInfo: new pkijs.EncapsulatedContentInfo({
      eContentType: "1.2.840.113549.1.7.1", // "data" content type
      eContent: new asn1js.OctetString({ valueHex: Convert.FromUtf8String(text) }),
    }),
    signerInfos: [
      new pkijs.SignerInfo({
        version: 1,
        sid: new pkijs.IssuerAndSerialNumber({
          issuer: certSimpl.issuer,
          serialNumber: certSimpl.serialNumber,
        }),
      }),
    ],
    certificates: [certSimpl],
  });

  await cmsSigned.sign(key, 0, hashAlgo);

  const cmsContentSimpl = new pkijs.ContentInfo();
  cmsContentSimpl.contentType = "1.2.840.113549.1.7.2";
  cmsContentSimpl.content = cmsSigned.toSchema();

  const schema = cmsContentSimpl.toSchema();
  const ber = schema.toBER(false);

  // Insert enveloped data into new Mime message
  const mimeBuilder = new MimeNode("application/pkcs7-mime; name=smime.p7m; smime-type=signed-data;")
    .setHeader("content-description", "Signed Data")
    .setHeader("content-disposition", "attachment; filename=smime.p7m")
    .setHeader("content-transfer-encoding", "base64")
    .setContent(new Uint8Array(ber));
  mimeBuilder.setHeader("from", "sender@example.com");
  mimeBuilder.setHeader("to", "recipient@example.com");
  mimeBuilder.setHeader("subject", "Example S/MIME signed message");

  return mimeBuilder.build();
}

export async function smimeVerify(smime: string, certificatePem: string) {
  // Parse S/MIME message to get CMS enveloped content
  const parser = smimeParse(smime);

  // Make all CMS data
  let asn1 = asn1js.fromBER(parser.content.buffer);
  if (asn1.offset === -1) {
    alert('Unable to parse your data. Please check you have "Content-Type: charset=binary" in your S/MIME message');
    return;
  }

  const cmsContentSimpl = new pkijs.ContentInfo({ schema: asn1.result });
  const cmsSignedSimpl = new pkijs.SignedData({ schema: cmsContentSimpl.content });

  // Decode input certificate
  asn1 = asn1js.fromBER(PemConverter.decode(certificatePem)[0]);
  const certSimpl = new pkijs.Certificate({ schema: asn1.result });

  // push certificate we got from DANE before verifying
  cmsSignedSimpl.certificates.push(certSimpl);

  const verificationParameters = {
    signer: 0,
    checkChain: false,
    extendedMode: true,
  };

  return cmsSignedSimpl.verify(verificationParameters);
}


/* ====================================================================================
    START of "MimeNode" class, based on "emailjs-mime-builder":

        Copyright (c) 2013 Andris Reinman

        Permission is hereby granted, free of charge, to any person obtaining a copy
        of this software and associated documentation files (the "Software"), to deal
        in the Software without restriction, including without limitation the rights
        to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
        copies of the Software, and to permit persons to whom the Software is
        furnished to do so, subject to the following conditions:

        The above copyright notice and this permission notice shall be included in
        all copies or substantial portions of the Software.

        THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
        IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
        FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
        AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
        LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
        OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
        THE SOFTWARE. 
========================================================================================*/
type MimeNodeOptions = {
    /** root node for this tree */
    rootNode?: MimeNode
    /** immediate parent for this node */
    parentNode?: MimeNode
    /** filename for an attachment node */
    filename?: string
    /** shared part of the unique multipart boundary */
    baseBoundary?: string
    /** should we include bcc in header? */
    includeBccInHeader?: boolean
}
/**
 * A mime tree node, being a root, branch, or leaf. 
 * The default constructor makes a new tree as the root node. 
 */
class MimeNode {

    nodeCounter:number
    content; includeBccInHeader
    baseBoundary:string 
    date:Date 
    rootNode:MimeNode; filename:string; parentNode:MimeNode; 
    _nodeId:number; _childNodes; _headers;

    /**
        * Creates a new mime tree node. Assumes 'multipart/*' as the content type
        * if it is a branch, anything else counts as leaf. If rootNode is missing from
        * the options, assumes this is the root.
        *
        * @param {String} contentType Define the content type for the node. Can be left blank for attachments (derived from filename)
        * @param {Object} [options] optional options
        * @param {Object} [options.rootNode] root node for this tree
        * @param {Object} [options.parentNode] immediate parent for this node
        * @param {Object} [options.filename] filename for an attachment node
        * @param {String} [options.baseBoundary] shared part of the unique multipart boundary
    */ 
    constructor (contentType:string, options:MimeNodeOptions = {}) {
      this.nodeCounter = 0
      /**
       * shared part of the unique multipart boundary
       */
      this.baseBoundary = options.baseBoundary || Date.now().toString() + Math.random()
  
      /**
       * If date headers is missing and current node is the root, this value is used instead
       */
      this.date = new Date()
  
      /**
       * Root node for current mime tree
       */
      this.rootNode = options.rootNode || this
  
      /**
       * If filename is specified but contentType is not (probably an attachment)
       * detect the content type from filename extension
       */
      if (options.filename) {
        /**
         * Filename for this node. Useful with attachments
         */
        this.filename = options.filename
        if (!contentType) {
          contentType = detectMimeType(this.filename.split('.').pop())
        }
      }
  
      /**
       * Immediate parent for this node (or undefined if not set)
       */
      this.parentNode = options.parentNode
  
      /**
       * Used for generating unique boundaries (prepended to the shared base)
       */
      this._nodeId = ++this.rootNode.nodeCounter
  
      /**
       * An array for possible child nodes
       */
      this._childNodes = []
  
      /**
       * A list of header values for this node in the form of [{key:'', value:''}]
       */
      this._headers = []
  
      /**
       * If content type is set (or derived from the filename) add it to headers
       */
      if (contentType) {
        this.setHeader('content-type', contentType)
      }
  
      /**
       * If true then BCC header is included in RFC2822 message.
       */
      this.includeBccInHeader = options.includeBccInHeader || false
    }
  
    /**
     * Creates and appends a child node. Arguments provided are passed to MimeNode constructor
     *
     * @param {String} [contentType] Optional content type
     * @param {Object} [options] Optional options object
     * @return {Object} Created node object
     */
    createChild (contentType:string, options = {}) {
      var node = new MimeNode(contentType, options)
      this.appendChild(node)
      return node
    }
  
    /**
     * Appends an existing node to the mime tree. Removes the node from an existing
     * tree if needed
     *
     * @param {Object} childNode node to be appended
     * @return {Object} Appended node object
     */
    appendChild (childNode: MimeNode) {
      if (childNode.rootNode !== this.rootNode) {
        childNode.rootNode = this.rootNode
        childNode._nodeId = ++this.rootNode.nodeCounter
      }
  
      childNode.parentNode = this
  
      this._childNodes.push(childNode)
      return childNode
    }
  
    /**
     * Replaces current node with another node
     *
     * @param {Object} node Replacement node
     * @return {Object} Replacement node
     */
    replace (node) {
      if (node === this) {
        return this
      }
  
      this.parentNode._childNodes.forEach((childNode, i) => {
        if (childNode === this) {
          node.rootNode = this.rootNode
          node.parentNode = this.parentNode
          node._nodeId = this._nodeId
  
          this.rootNode = this
          this.parentNode = undefined
  
          node.parentNode._childNodes[i] = node
        }
      })
  
      return node
    }
  
    /**
     * Removes current node from the mime tree
     *
     * @return {Object} removed node
     */
    remove () {
      if (!this.parentNode) {
        return this
      }
  
      for (var i = this.parentNode._childNodes.length - 1; i >= 0; i--) {
        if (this.parentNode._childNodes[i] === this) {
          this.parentNode._childNodes.splice(i, 1)
          this.parentNode = undefined
          this.rootNode = this
          return this
        }
      }
    }
  
    /**
     * Sets a header value. If the value for selected key exists, it is overwritten.
     * You can set multiple values as well by using [{key:'', value:''}] or
     * {key: 'value'} as the first argument.
     *
     * @param {String|Array|Object} key Header key or a list of key value pairs
     * @param {String} value Header value
     * @return {Object} current node
     */
    setHeader (key, value) {
      let added = false
  
      // Allow setting multiple headers at once
      if (!value && key && typeof key === 'object') {
        if (key.key && key.value) {
          // allow {key:'content-type', value: 'text/plain'}
          this.setHeader(key.key, key.value)
        } else if (Array.isArray(key)) {
          // allow [{key:'content-type', value: 'text/plain'}]
          key.forEach(i => this.setHeader(i.key, i.value))
        } else {
          // allow {'content-type': 'text/plain'}
          Object.keys(key).forEach(i => this.setHeader(i, key[i]))
        }
        return this
      }
  
      key = normalizeHeaderKey(key)
  
      const headerValue = { key, value }
  
      // Check if the value exists and overwrite
      for (var i = 0, len = this._headers.length; i < len; i++) {
        if (this._headers[i].key === key) {
          if (!added) {
            // replace the first match
            this._headers[i] = headerValue
            added = true
          } else {
            // remove following matches
            this._headers.splice(i, 1)
            i--
            len--
          }
        }
      }
  
      // match not found, append the value
      if (!added) {
        this._headers.push(headerValue)
      }
  
      return this
    }
  
    /**
     * Adds a header value. If the value for selected key exists, the value is appended
     * as a new field and old one is not touched.
     * You can set multiple values as well by using [{key:'', value:''}] or
     * {key: 'value'} as the first argument.
     *
     * @param {String|Array|Object} key Header key or a list of key value pairs
     * @param {String} value Header value
     * @return {Object} current node
     */
    addHeader (key, value) {
      // Allow setting multiple headers at once
      if (!value && key && typeof key === 'object') {
        if (key.key && key.value) {
          // allow {key:'content-type', value: 'text/plain'}
          this.addHeader(key.key, key.value)
        } else if (Array.isArray(key)) {
          // allow [{key:'content-type', value: 'text/plain'}]
          key.forEach(i => this.addHeader(i.key, i.value))
        } else {
          // allow {'content-type': 'text/plain'}
          Object.keys(key).forEach(i => this.addHeader(i, key[i]))
        }
        return this
      }
  
      this._headers.push({ key: normalizeHeaderKey(key), value })
  
      return this
    }
  
    /**
     * Retrieves the first mathcing value of a selected key
     *
     * @param {String} key Key to search for
     * @retun {String} Value for the key
     */
    getHeader (key) {
      key = normalizeHeaderKey(key)
      for (let i = 0, len = this._headers.length; i < len; i++) {
        if (this._headers[i].key === key) {
          return this._headers[i].value
        }
      }
    }
  
    /**
     * Sets body content for current node. If the value is a string, charset is added automatically
     * to Content-Type (if it is text/*). If the value is a Typed Array, you need to specify
     * the charset yourself
     *
     * @param (String|Uint8Array) content Body content
     * @return {Object} current node
     */
    setContent (content) {
      this.content = content
      return this
    }
  
    /**
     * Builds the rfc2822 message from the current node. If this is a root node,
     * mandatory header fields are set if missing (Date, Message-Id, MIME-Version)
     *
     * @return {String} Compiled message
     */
    build () {
      const lines = []
      const contentType = (this.getHeader('Content-Type') || '').toString().toLowerCase().trim()
      let transferEncoding
      let flowed
  
      if (this.content) {
        transferEncoding = (this.getHeader('Content-Transfer-Encoding') || '').toString().toLowerCase().trim()
        if (!transferEncoding || ['base64', 'quoted-printable'].indexOf(transferEncoding) < 0) {
          if (/^text\//i.test(contentType)) {
            // If there are no special symbols, no need to modify the text
            if (isPlainText(this.content)) {
              // If there are lines longer than 76 symbols/bytes, make the text 'flowed'
              if (/^.{77,}/m.test(this.content)) {
                flowed = true
              }
              transferEncoding = '7bit'
            } else {
              transferEncoding = 'quoted-printable'
            }
          } else if (!/^multipart\//i.test(contentType)) {
            transferEncoding = transferEncoding || 'base64'
          }
        }
  
        if (transferEncoding) {
          this.setHeader('Content-Transfer-Encoding', transferEncoding)
        }
      }
  
      if (this.filename && !this.getHeader('Content-Disposition')) {
        this.setHeader('Content-Disposition', 'attachment')
      }
  
      this._headers.forEach(header => {
        const key = header.key
        let value = header.value
        let structured
  
        switch (header.key) {
          case 'Content-Disposition':
            structured = parseHeaderValue(value)
            if (this.filename) {
              structured.params.filename = this.filename
            }
            value = buildHeaderValue(structured)
            break
          case 'Content-Type':
            structured = parseHeaderValue(value)
  
            this._addBoundary(structured)
  
            if (flowed) {
              structured.params.format = 'flowed'
            }
            if (String(structured.params.format).toLowerCase().trim() === 'flowed') {
              flowed = true
            }
  
            if (structured.value.match(/^text\//) && typeof this.content === 'string' && /[\u0080-\uFFFF]/.test(this.content)) {
              structured.params.charset = 'utf-8'
            }
  
            value = buildHeaderValue(structured)
            break
          case 'Bcc':
            if (this.includeBccInHeader === false) {
              // skip BCC values
              return
            }
        }
  
        // skip empty lines
        value = encodeHeaderValue(key, value)
        if (!(value || '').toString().trim()) {
          return
        }
  
        lines.push(foldLines(key + ': ' + value))
      })
  
      // Ensure mandatory header fields
      if (this.rootNode === this) {
        if (!this.getHeader('Date')) {
          lines.push('Date: ' + this.date.toUTCString().replace(/GMT/, '+0000'))
        }
        // You really should define your own Message-Id field
        if (!this.getHeader('Message-Id')) {
            let arr:any[] = [0,0,0]
          lines.push('Message-Id: <' +
            // crux to generate random strings like this:
            // "1401391905590-58aa8c32-d32a065c-c1a2aad2"
            arr.reduce((prev)=>{
              return prev + '-' + Math.floor((1 + Math.random()) * 0x100000000)
                .toString(16)
                .substring(1)
            }, Date.now()) +
            '@' +
            // try to use the domain of the FROM address or fallback localhost
            (this.getEnvelope().from+"" || 'localhost').split('@').pop() +
            '>')
        }
        if (!this.getHeader('MIME-Version')) {
          lines.push('MIME-Version: 1.0')
        }
      }
      lines.push('')
  
      if (this.content) {
        switch (transferEncoding) {
          case 'quoted-printable':
            lines.push(quotedPrintableEncode(this.content))
            break
          case 'base64':
            lines.push(base64Encode(this.content, typeof this.content === 'object' ? 'binary' : undefined))
            break
          default:
            if (flowed) {
              // space stuffing http://tools.ietf.org/html/rfc3676#section-4.2
              lines.push(foldLines(this.content.replace(/\r?\n/g, '\r\n').replace(/^( |From|>)/igm, ' $1'), 76, true))
            } else {
              lines.push(this.content.replace(/\r?\n/g, '\r\n'))
            }
        }
        if (this.multipart) {
          lines.push('')
        }
      }
  
      if (this.multipart) {
        this._childNodes.forEach(node => {
          lines.push('--' + this.boundary)
          lines.push(node.build())
        })
        lines.push('--' + this.boundary + '--')
        lines.push('')
      }
  
      return lines.join('\r\n')
    }
  
    /**
     * Generates and returns SMTP envelope with the sender address and a list of recipients addresses
     *
     * @return {Object} SMTP envelope in the form of {from: 'from@example.com', to: ['to@example.com']}
     */
    getEnvelope () {
      var envelope = {
        from: false,
        to: []
      }
      this._headers.forEach(header => {
        var list = []
        if (header.key === 'From' || (!envelope.from && ['Reply-To', 'Sender'].indexOf(header.key) >= 0)) {
          convertAddresses(parseAddresses(header.value), list)
          if (list.length && list[0]) {
            envelope.from = list[0]
          }
        } else if (['To', 'Cc', 'Bcc'].indexOf(header.key) >= 0) {
          convertAddresses(parseAddresses(header.value), envelope.to)
        }
      })
  
      return envelope
    }
  
    /**
     * Checks if the content type is multipart and defines boundary if needed.
     * Doesn't return anything, modifies object argument instead.
     *
     * @param {Object} structured Parsed header value for 'Content-Type' key
     */
    _addBoundary (structured) {
      this.contentType = structured.value.trim().toLowerCase()
  
      this.multipart = this.contentType.split('/').reduce(function (prev, value) {
        return prev === 'multipart' ? value : false
      })
  
      if (this.multipart) {
        this.boundary = structured.params.boundary = structured.params.boundary || this.boundary || generateBoundary(this._nodeId, this.rootNode.baseBoundary)
      } else {
        this.boundary = false
      }
    }
    contentType; multipart; boundary
  }
/*======================================================================================
  END of adapted content
========================================================================================*/ 
/**
 * 
 * @param elem The HTML div element
 * @param duration number of ms to flash - default is 400
 */
export function flashElem(elem:HTMLDivElement,duration?:number) {
  if (duration==null) duration = 400
  let easeFunc = t => t*(2-t) // quadratic ease-out
  let luma = c => 0.2126*c.r + 0.7152*c.g + 0.0722*c.b // linear luminence (flash up or down)
  let startColors = window.getComputedStyle(elem).backgroundColor.trim().slice(4,-1).split(',')
  let color1 = {
    r: parseInt(startColors[0]), 
    g: parseInt(startColors[1]), 
    b: parseInt(startColors[2]),
    a: null
  }
  if (startColors[3]) color1.a = parseInt(startColors[3])
}

// module.exports = {
//     decodeHtml: decodeHtml,
//     encodeHtml: encodeHtml,
//     smimeEncrypt: smimeEncrypt,
//     smimeDecrypt: smimeDecrypt,
//     decodePem: decodePem
// }