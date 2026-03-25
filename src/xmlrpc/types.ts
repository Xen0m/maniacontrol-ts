export type XmlRpcScalar = string | number | boolean | null | Date;
export type XmlRpcValue =
  | XmlRpcScalar
  | XmlRpcValue[]
  | { [key: string]: XmlRpcValue };

export interface XmlRpcFault {
  faultCode: number;
  faultString: string;
}

export interface XmlRpcCallMessage {
  type: "call";
  method: string;
  params: XmlRpcValue[];
}

export interface XmlRpcResponseMessage {
  type: "response";
  value: XmlRpcValue;
}

export interface XmlRpcFaultMessage {
  type: "fault";
  value: XmlRpcFault;
}

export type XmlRpcMessage =
  | XmlRpcCallMessage
  | XmlRpcResponseMessage
  | XmlRpcFaultMessage;
