/*----------------------------------------------------
 * © 2021 George Mason University 
 * For further information please contact ott@gmu.edu
------------------------------------------------------*/

/** 
 * This links up all crypto dependencies and contains our custom-built DANE-S/MIME helper functions. 
 */

//const WebCrypto = require("@peculiar/webcrypto").Crypto // unneeded if we assume browser compat.
import * as he from "he"
import { Convert } from "pvtsutils"
import {stringToArrayBuffer, arrayBufferToString} from "pvutils"
//const MimeBuilder = require("emailjs-mime-builder") 
import smimeParse from "emailjs-mime-parser" 
import * as asn1js from "asn1js"
import * as pkijs from "pkijs"
import { base64Encode, quotedPrintableEncode, foldLines, parseHeaderValue } from 'emailjs-mime-codec'
import { detectMimeType } from 'emailjs-mime-types'
import { convertAddresses, parseAddresses, encodeHeaderValue, normalizeHeaderKey, 
    generateBoundary, isPlainText, buildHeaderValue } from 'emailjs-mime-builder/dist/utils'  
//import { PemConverter } from "@peculiar/x509"
import * as DTypes from "../local_types/dane" 
import * as forge from "node-forge"

export const VERBOSE_LOGS = true

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


/** Returns string <'s and >'s etc encoded into html */
export function htmlEncode(preHTML:string): string {
  return he.encode(preHTML)
}
/** Returns decoded string from html */
export function htmlDecode(html:string): string {
  return he.decode(html)
}


export function PEMencode(a, b) {
  return PemConverter.encode(a,b)
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
  const asn1 = asn1js.fromBER(PemConverter.decode(certificatePem)[0]);
  const certSimpl = new pkijs.Certificate({ schema: asn1.result });

  const cmsEnveloped = new pkijs.EnvelopedData();

  cmsEnveloped.addRecipientByCertificate(certSimpl, {
      oaepHashAlgorithm: oaepHashAlgo,
  });

  await cmsEnveloped.encrypt(
      { name: encryptionAlgo, length: length },
      Convert.FromUtf8String(text)
  );

  const cmsContentSimpl = new pkijs.ContentInfo();
  cmsContentSimpl.contentType = "1.2.840.113549.1.7.3";
  cmsContentSimpl.content = cmsEnveloped.toSchema();

  const schema = cmsContentSimpl.toSchema();
  const ber = schema.toBER(false);

  // Insert enveloped data into new Mime message
  const mimeBuilder = new MimeNode(
      "application/pkcs7-mime; name=smime.p7m; smime-type=enveloped-data; charset=binary"
  )
      .setHeader("content-description", "Enveloped Data")
      .setHeader("content-disposition", "attachment; filename=smime.p7m")
      .setHeader("content-transfer-encoding", "base64")
      .setContent(new Uint8Array(ber));

  return mimeBuilder.build();
}

/**
 * Adapted from PKI.js' SMIMEEncryptionExample
 * @returns {string} decrypted string
 * @param {string} text string to decrypt
 * @param {string} privateKeyPem user's private key to decrypt with in PEM format
 */
 export async function smimeDecrypt(
  text: string,
  privateKeyPem: string
): Promise<string> {
  // Decode input private key
  const privateKeyBuffer = PemConverter.decode(privateKeyPem)[0];
  let parser
  // Parse S/MIME message to get CMS enveloped content
  try {
      parser = smimeParse(text);
    } catch (err) {
      // Not an S/MIME message
      if (VERBOSE_LOGS) console.error(err);
      if (VERBOSE_LOGS) console.log(err.code,err.message,err.name)
      if (VERBOSE_LOGS) console.log(text)
      throw new Error("SmimeParseError");
  }
      // Make all CMS data
      const asn1 = asn1js.fromBER(parser.content.buffer);
      if (asn1.offset === -1) {
          throw new Error(
              'Unable to parse your data. Please check you have "Content-Type: charset=binary" in your S/MIME message'
          );
      }

      const cmsContentSimpl = new pkijs.ContentInfo({ schema: asn1.result });
      const cmsEnvelopedSimpl = new pkijs.EnvelopedData({
          schema: cmsContentSimpl.content,
      });
      let message
    try{
      message = await cmsEnvelopedSimpl.decrypt(0, {
          recipientPrivateKey: privateKeyBuffer,
      });
    } catch (err) {
      // Not an S/MIME message
      if (VERBOSE_LOGS) console.error(err);
      if (VERBOSE_LOGS) console.log(err.code,err.message,err.name)
      if (VERBOSE_LOGS) console.log(text)
      throw new Error("SmimeDecryptError");
  }
      let toReturn = Convert.ToUtf8String(message);
      if (VERBOSE_LOGS) console.log('SMIME-decrypt-output', JSON.stringify(toReturn))
      return toReturn
}

/**
 * @returns {String} signed string
 * @param {String} text string to sign
 * @param {String} privateKeyPem user's private key to sign with in PEM format
 * @param {String} certificatePem user's public cert to sign with in PEM format
 */
 export async function smimeSign(
  text: string,
  privateKeyPem: string,
  certificatePem: string,
  sender?: string,
  recipient?: string,
  subject?: string
): Promise<string> {
  // create PKCS#7 signed data with authenticatedAttributes
  // attributes include: PKCS#9 content-type, message-digest, and signing-time
  const p7 = forge.pkcs7.createSignedData();

  // set content
  p7.content = forge.util.createBuffer(text, "utf8");
  if (VERBOSE_LOGS) console.log('SMIME-sign-input', JSON.stringify(text), privateKeyPem)
  // add signer
  p7.addCertificate(certificatePem);
  p7.addSigner({
      key: privateKeyPem,
      certificate: certificatePem,
      digestAlgorithm: forge.pki.oids.sha256,
      authenticatedAttributes: [
          {
              type: forge.pki.oids.contentType,
              value: forge.pki.oids.data,
          },
          {
              type: forge.pki.oids.messageDigest,
              // value will be auto-populated at signing time
          },
          {
              type: forge.pki.oids.signingTime,
              // value can also be auto-populated at signing time
              value: new Date().toString(),
          },
      ],
  });

  // sign
  p7.sign({ detached: true });
  let pem = forge.pkcs7.messageToPem(p7);
  pem = pem.replace(/-----BEGIN PKCS7-----\r?\n?/, "");
  pem = pem.replace(/-----END PKCS7-----\r?\n?/, "");

  const binaryPem = Buffer.from(pem, "base64");

  // Create new multipart/signed Mime message
  const mimeBuilder = new MimeNode(
      'multipart/signed; protocol="application/pkcs7-signature"; micalg=sha-256; name=smime.p7m;'
  );

  if (sender) {
      mimeBuilder.setHeader("from", sender);
  }
  if (recipient) {
      mimeBuilder.setHeader("to", recipient);
  }
  if (subject) {
      mimeBuilder.setHeader("subject", subject);
  }

  const plainText = new MimeNode("text/plain").setContent(text);

  const mimeSignature = new MimeNode(
      "application/pkcs7-signature; name=smime.p7s; charset=binary"
  )
      .setHeader("content-description", "Signed Data")
      .setHeader("content-disposition", "attachment; filename=smime.p7s")
      .setHeader("content-transfer-encoding", "base64")
      .setContent(binaryPem);

  mimeBuilder.appendChild(plainText);
  mimeBuilder.appendChild(mimeSignature);
    let signedMimeNodes = mimeBuilder.build()
  if (VERBOSE_LOGS) console.log('SMIME-sign-output', JSON.stringify(signedMimeNodes))
  return signedMimeNodes
  
}
/**
 * Get an SMIMEA record for a corresponding email address if it exists
 * @param {String} emailAddress email address to get SMIMEA record for
 */
 export async function DNSGetSMIMEA(
  emailAddress: string
): Promise<DTypes.CloudflareSMIMEARecord> {
  // Cloudflare DNS-over-HTTPS service
  const DNSServer = "https://cloudflare-dns.com/dns-query";

  const localPart = emailAddress.split("@")[0];
  const domain = emailAddress.split("@")[1];

  if (!localPart || !domain) {
      // TODO: error
      return;
  }

  // hash2-256
  const hashedLocalPart = await sha256(localPart);
  // truncate to 28 octets (Javascript characters are 2 bytes each)
  const LHS = hashedLocalPart.substring(0, 28 * 2);

  const SMIMEAQueryLocation = `${LHS}._smimecert.${domain}`;

  const queryURL = new URL(DNSServer);
  queryURL.searchParams.set("name", SMIMEAQueryLocation);
  queryURL.searchParams.set("type", "SMIMEA");

  // Make our request to Cloudflare
  return await fetch(queryURL.href, {
      headers: {
          Accept: "application/dns-json",
      },
  })
      .then(async (res) => {
          //if (VERBOSE_LOGS) console.dir(JSON.stringify(res));
          const json = await res.json();
          //if (VERBOSE_LOGS) console.dir(JSON.stringify(json));
          return json;
      })
      .catch((err) => {
          return null;
      });
}
export async function smimeVerify(smime: string, certificatePem: string): Promise<{signatureVerified: boolean}> {
  let parser;
  if (VERBOSE_LOGS) console.log('SMIME-verify', JSON.stringify(smime), certificatePem)
  try {
      // Parse S/MIME message to get CMS signed content
      parser = smimeParse(smime);
  } catch (err) {
      throw new Error(`Unable to parse your data: ${err}`);
  }

  if (!parser.childNodes || parser.childNodes.length !== 2) {
      // non-multipart S/MIME
      throw new Error("No child nodes!");
  }

  let asn1;

  // detached signature, check signature child node
  const lastNode = parser.childNodes[1];
  if (
      lastNode.contentType.value === "application/pkcs7-signature" ||
      lastNode.contentType.value === "application/x-pkcs7-signature"
  ) {
      asn1 = asn1js.fromBER(lastNode.content.buffer);
      if (asn1.offset === -1) {
          throw new Error(
              'Unable to parse your data. Please check you have "Content-Type: charset=binary" in your S/MIME message'
          );
      }
  } else {
      throw new Error("Unsupported signing format");
  }

  if (!asn1) return;

  let cmsContentSimpl;
  let cmsSignedSimpl;
  try {
      cmsContentSimpl = new pkijs.ContentInfo({ schema: asn1.result });
      cmsSignedSimpl = new pkijs.SignedData({
          schema: cmsContentSimpl.content,
      });
  } catch (err) {
      throw new Error(`Incorrect message format: ${err}`);
  }

  // Decode input certificate
  asn1 = asn1js.fromBER(PemConverter.decode(certificatePem)[0]);
  const certSimpl = new pkijs.Certificate({ schema: asn1.result });

  // push certificate we got from DANE before verifying
  cmsSignedSimpl.certificates.push(certSimpl);

  const signedDataBuffer = parser.childNodes[0].content.buffer;

  const verificationParameters = {
      signer: 0,
      data: signedDataBuffer,
      extendedMode: true,
  };
  let toReturn = await cmsSignedSimpl.verify(verificationParameters);
  if (VERBOSE_LOGS) console.dir(toReturn)
  return toReturn
  
}


/** Returns the inner message of a signed email */
export async function smimeGetSignatureBody(smime: string): Promise<string> {
  let parser;
  try {
      // Parse S/MIME message to get CMS signed content
      parser = smimeParse(smime);
  } catch (err) {
      throw new Error(`Unable to parse your data: ${err}`);
  }

  if (!parser.childNodes || parser.childNodes.length !== 2) {
      // non-multipart S/MIME
      throw new Error("No child nodes!");
  }

  // detached signature, check first child node for body
  const bodyNode = parser.childNodes[0];
  if (bodyNode.contentType.value === "text/plain") {
    let toReturn = arrayBufferToString(bodyNode.content.buffer);
    toReturn = decodeURIComponent(escape(toReturn)) // we must decode utf-8 bytes to get unicode string 
    if (VERBOSE_LOGS) console.log('result of smimeGetSignatureBody\n',JSON.stringify(toReturn))
    return toReturn
  } else {
      throw new Error(
          `Unsupported body type: ${bodyNode.contentType.value} is not "text/plain"`
      );
  }
}
/**
 * Convert an S/MIMEA record from Cloudflare to a usable S/MIMEA record interface
 * @returns {ArrayBuffer}
 * @param {String} hexString space separated hex string to convert (eg. AA BB CC DD)
 */
export function CloudflareSMIMEARecordToSMIMEARecord(
    hexString: string
): DTypes.SMIMEARecord {
    // ignore \# 730 at the start
    hexString = hexString.substring(7);

    const SMIMEARecord = {} as DTypes.SMIMEARecord;
    SMIMEARecord.certUsage = Number(hexString.substring(0, 2));
    SMIMEARecord.selector = Number(hexString.substring(3, 5));
    SMIMEARecord.matchingType = Number(hexString.substring(6, 8));

    const binaryCertificateString = hexString.substring(8);
    const typedArray = new Uint8Array(
        binaryCertificateString.match(/[\da-f]{2}/gi).map(function (h) {
            return parseInt(h, 16);
        })
    );
    SMIMEARecord.binaryCertificate = typedArray.buffer;

    return SMIMEARecord;
}

async function sha256(text: string): Promise<string> {
  // UTF-8 encode
  const msgBuffer = new TextEncoder().encode(text);

  // hash text
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);

  // convert from ArrayBuffer to Array
  const hashArray = Array.from(new Uint8Array(hashBuffer));

  // convert bytes to hex string
  const hashHex = hashArray
      .map((b) => ("00" + b.toString(16)).slice(-2))
      .join("");
  return hashHex;
}
/*----------------------------------------------------
 * © 2021 George Mason University 
 * For further information please contact ott@gmu.edu
------------------------------------------------------*/

/* ------------------------------------------------------------------------------------
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
---------------------------------------------------------------------------------------- */
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
/* -------------------------------------------------------------------------------
 * MIT License
 * 
 * Copyright (c) Peculiar Ventures. All rights reserved.
 * 
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * 
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * 
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 * 
 */
class PemConverter {
  CertificateTag; CertificateRequestTag; PublicKeyTag; PrivateKeyTag

  constructor() {
      this.CertificateTag = "CERTIFICATE";
      this.CertificateRequestTag = "CERTIFICATE REQUEST";
      this.PublicKeyTag = "PUBLIC KEY";
      this.PrivateKeyTag = "PRIVATE KEY";
  }
  static isPem(data) {
      return typeof data === "string"
          && /-{5}BEGIN [A-Z0-9 ]+-{5}([a-zA-Z0-9=+/\n\r]+)-{5}END [A-Z0-9 ]+-{5}/g.test(data);
  }
  static decode(pem) {
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
  static encode(rawData, tag) {
      if (Array.isArray(rawData)) {
          const raws = new Array();
          rawData.forEach(element => {
              raws.push(this.encodeBuffer(element, tag));
          });
          return raws.join("\n");
      }
      else {
          return this.encodeBuffer(rawData, tag);
      }
  }
  static encodeBuffer(rawData, tag) {
      const base64 = Convert.ToBase64(rawData);
      let sliced;
      let offset = 0;
      const rows = Array();
      while (offset < base64.length) {
          if (base64.length - offset < 64) {
              sliced = base64.substring(offset);
          }
          else {
              sliced = base64.substring(offset, offset + 64);
              offset += 64;
          }
          if (sliced.length !== 0) {
              rows.push(sliced);
              if (sliced.length < 64) {
                  break;
              }
          }
          else {
              break;
          }
      }
      const upperCaseTag = tag.toLocaleUpperCase();
      return `-----BEGIN ${upperCaseTag}-----\n${rows.join("\n")}\n-----END ${upperCaseTag}-----`;
  }
}
/* ------------------------------------------------------------------------------------------------ */