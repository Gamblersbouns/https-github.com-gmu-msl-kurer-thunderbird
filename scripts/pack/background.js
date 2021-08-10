"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * This is the entry-point for the Thunderbird plugin API made available as a background script for Kurer.
 * This is compiled by webpack (`npm run build`) into `scripts/background_bundled.js` which is loaded via the main manifest.
 */
const Common = require("./common");
/** Private key just for testing. */
const test_key = `
-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDOvu1G4nwuRHrX
MwJPRmbva2KEiEhu3c+Tsf8EG821tfhmZz0XdtN16cCvBhoAbzM+oij/X2u87fFm
yNCUfZUpvWRuXauzVjzyd+8SLmbvHzxhycj3K9ZCu6fcKRsoIm1t56mS3iEzHHMn
qv6GBmquJaoAnv6TWDnO8PeSBbE556C8XDaWto03c2Abt/S7RVcF3FRL92FtNoGW
TDGHKyd75HE8T+Wavjv14sl+ILImPipduEAgvLWuYn8fa9Ne8twkAGRrPwzpxpPe
OwX6BjPUn92PXC/cK4zrvaUmvOGVh47+ngl7h+s+ZN28qLrmdleYTOufsMmcYNzz
k30rDJ+rAgMBAAECggEAGH9UEzmj+EGCArzXEbioWscxIb4aQxTCU2BcdMqsmdLp
j4y9FuosDUU44SRKcXG7szi4veW7GORi3ch+upGU2qDH5THxNetKhnqCl/dql/vu
BjJIP01w8nBU6Afw4VUO/V5dX/s1GN7OoE0pIo1hF6h7193/EUt7chNoamOFR/R9
N6/NESujIgVZpOo26cj6wfYnMaGO/YOahutT275IIYwzjVQYTwLTcBdWfyqmU/r0
kx9FCSgjEooYhP6MgyZ5S1/huTz7ELhqqWw2JWX3yt02KfjR5dofGr523Qv7xGff
boxhrD+0YkjyhCXrYUXIbWZrqyTNknNjnxPPW2+ljQKBgQDorpBYvi2FaUv94qwC
Mhuek5SJlqTfvKS2D6Ayab31HfuHW9bkGppy2qtdo8/oQjWefSEQdoJuz7lTaPfG
LPD4GqSnkZq1VCOZMLb9sZcaRr2ckuM51f2huvqsrAIBqJZmX4nq5J4vOudp1zVb
qinUu4OinHBII/HnliPfrDiONwKBgQDjdvmMrwYgsIz2xt9ZgZFZRkoxeLBblAi4
PXEket1vS1KEljpIbJHg2ETvQaTJeXGkJ4oLPVWMhZSMYiwzgxrhjXcQRHqlbYig
Y2lgdtjImC+Gp41Bj5DeWsIozsQk9e/tg+/doAQJhI8L+7i3O5no1nY1MqRah2KL
VHR2ovFgLQKBgFv5DGOXoMS4T2pmm9kuV06CRVdxbXBmz7CLUqY6t/RYyqDBg5qc
jWpS1yPnaXoEGc+w5E3umjYU88ttlWsHPqTDW0xFOKLuRDf8UojLFtAzICXwxdKJ
rHyuPQHd59kh+3kx0IFBpulCXlCu2Y+HHovRJwIy1gsd8jO5XCrAl4ZXAoGAby0X
i8uAEzo3q+ZIBFdv01KnsMZsbFZObL6bLllfIaaPDn7evcdTBbKu/sH26QKSqMkq
j5PK3IPtty/EqujJmrSqHSlbSL/gp4PvXVa5XlID6Ky8Pe8Nv6BchdWJyQbr3gs+
kfREBOLlh9Xg0q4u677mx9mYuyaw46jDw7iggYECgYEAuSmZT6LzftUaQtE2oUKq
rJ9bz7gqXZQnVvbWuCelvxbAt8S84K7522geUPqTQf1o+QNdh0E/JVREiHu6B+QB
n9z1ff6580uztO+0ZbM7kpzTpXDYmgGFrRyLN76VhoaBafUR4KxCIml2zbUhirBh
us12FEPujm2Z4mPbqIDQgm0=
-----END PRIVATE KEY-----
`;
/** Matching public cert just for testing */
const test_cert = `
-----BEGIN CERTIFICATE-----
MIIC0zCCAb2gAwIBAgIBATALBgkqhkiG9w0BAQswHjEcMAkGA1UEBhMCUlUwDwYD
VQQDHggAVABlAHMAdDAeFw0xNjAyMDEwNTAwMDBaFw0xOTAyMDEwNTAwMDBaMB4x
HDAJBgNVBAYTAlJVMA8GA1UEAx4IAFQAZQBzAHQwggEiMA0GCSqGSIb3DQEBAQUA
A4IBDwAwggEKAoIBAQDOvu1G4nwuRHrXMwJPRmbva2KEiEhu3c+Tsf8EG821tfhm
Zz0XdtN16cCvBhoAbzM+oij/X2u87fFmyNCUfZUpvWRuXauzVjzyd+8SLmbvHzxh
ycj3K9ZCu6fcKRsoIm1t56mS3iEzHHMnqv6GBmquJaoAnv6TWDnO8PeSBbE556C8
XDaWto03c2Abt/S7RVcF3FRL92FtNoGWTDGHKyd75HE8T+Wavjv14sl+ILImPipd
uEAgvLWuYn8fa9Ne8twkAGRrPwzpxpPeOwX6BjPUn92PXC/cK4zrvaUmvOGVh47+
ngl7h+s+ZN28qLrmdleYTOufsMmcYNzzk30rDJ+rAgMBAAGjIDAeMA8GA1UdEwQI
MAYBAf8CAQMwCwYDVR0PBAQDAgAGMAsGCSqGSIb3DQEBCwOCAQEAEd9FkGtoWI7R
Npmid/4TjI/sziPJ54eM7XDXwwV7gPSTMY3vVJ/MHGxwT9ZYbT2+T6PvhQIdSEs+
a3Hn454ywqA37HFb37nE93bU5ss+uZ1RyICR24xFuMs+n0iRXD8MTZI+HEaTZ6tl
lRqIKG7jM5JSJwGoladoPl8gN+Dp0StqQHp8PmTepBhnmiboPOwMifSoUOcF151q
kilxM5V6RZ1UWEkagZUPI7yZatabOBh89seMiKgul76ROacXlhWIU384ZUDn0ADi
E1W4oQ4MAX8TuY06fg1HIGBz17kKC/x4YJ8ZAt0imXv4+oAcq9cNuCvyG6R+u+3T
DKqBBM8G3A==
-----END CERTIFICATE-----
`;
/** Function executed on creation of a new compose tab */
function injectCompose(tab) {
    console.log(`opened compose tab with id=${tab.id}`);
}
/** Function executed on creation of a new display (message reading) tab*/
function injectDisplay(tab) {
    console.log(`opened display tab with id=${tab.id}`);
}
browser.runtime.onMessage.addListener((data, sender) => {
    // test message just sends back the date and an echo with a random delay of a couple seconds
    if (data.type == "test_msg") {
        return new Promise(resolve => {
            setTimeout(() => {
                resolve({ response: `return message on ${(new Date()).toLocaleDateString()}`, echo: data.echo });
            }, Math.random() * 3000 + 500);
        });
    }
    /* test message which returns the mime string of the given text, with preset keys, certs, and headers
            message object: {
                type: "get_encrypted_mime_str",
                msg: <string body of mime message>
            }
    */
    if (data.type == "get_encrypted_mime_str") {
        return Common.smimeEncrypt(data.msg, test_cert);
    }
});
browser.tabs.onCreated.addListener(tab => {
    console.log(`Opened tab detected:\n${JSON.stringify(tab)}`);
    browser.windows.get(tab.windowId).then(window => {
        if ((window.type) == "messageCompose")
            injectCompose(tab);
        else if ((window.type) == "messageDisplay")
            injectDisplay(tab);
    });
});
console.log("Background script finished loading 123!");
//console.log(`Test decode PEM:\n${Common.decodePem}`)
