export interface CloudflareSMIMEARecordQuestion {
    name: string;
    type: number;
}

export interface CloudflareSMIMEARecordAnswer {
    name: string;
    type: number;
    TTL: number;
    data: string;
}

export interface CloudflareSMIMEARecordAuthority {
    name: string;
    type: number;
    TTL: number;
    data: string;
}

export interface CloudflareSMIMEARecord {
    Status: number;
    TC: boolean;
    RD: boolean;
    RA: boolean;
    AD: boolean;
    CD: boolean;
    Authority?: CloudflareSMIMEARecordAuthority[];
    Question?: CloudflareSMIMEARecordQuestion[];
    Answer?: CloudflareSMIMEARecordAnswer[];
}

export interface SMIMEARecord {
    certUsage: number;
    selector: number;
    matchingType: number;
    binaryCertificate: ArrayBuffer;
}