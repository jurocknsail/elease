interface XML {
  "?xml": {
    version: string;
    encoding: string;
  };
}

interface Header {
  message: string;
  ID: string;
  Test: boolean;
  Prepared: string;
  Sender: {
    Name: {
      "#text": string;
      "xml:lang": string;
    };
    id: string;
  };
  Structure: {
    StructureUsage: {
      Ref: {
        agencyID: string;
        id: string;
        version: string;
      };
    };
    structureID: string;
    namespace: string;
    dimensionAtObservation: string;
  };
  Source: {
    "#text": string;
    "xml:lang": string;
  };
}

interface Obs {
  TIME_PERIOD: string;
  OBS_VALUE: string;
  OBS_STATUS: string;
  OBS_QUAL: string;
  OBS_TYPE: string;
  DATE_JO?: string;
}

interface Series {
  Obs: Obs[];
  IDBANK: string;
  FREQ: string;
  TITLE_FR: string;
  TITLE_EN: string;
  LAST_UPDATE: string;
  UNIT_MEASURE: string;
  UNIT_MULT: string;
  REF_AREA: string;
  DECIMALS: string;
}

interface DataSet {
  Series: Series;
}

interface StructureSpecificData {
  Header: Header;
  "message:DataSet": DataSet;
}

interface InseeDataRootObject {
  "?xml": XML;
  "message:StructureSpecificData": StructureSpecificData;
  "xmlns:ss": string;
  "xmlns:footer": string;
  "xmlns:ns1": string;
  "xmlns:message": string;
  "xmlns:common": string;
  "xmlns:xsi": string;
  "xmlns:xml": string;
}
