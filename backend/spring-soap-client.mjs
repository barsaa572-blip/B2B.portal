const xmlEscape = value => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

const xmlDecode = value => String(value ?? '')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'")
  .replace(/&amp;/g, '&');

const xmlValue = (xml, tag) => {
  const escaped = String(tag).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`<(?:(?:[\\w.-]+):)?${escaped}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${escaped}>`, 'i').exec(String(xml));
  return match ? xmlDecode(match[1].replace(/<[^>]*>/g, '').trim()) : null;
};

const serviceEndpoint = wsdlUrl => String(wsdlUrl || '').trim().replace(/[?&]wsdl(?:=[^&]*)?$/i, '');
const finiteNumber = value => {
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
};

export function getSpringSoapStatus(env = process.env) {
  const endpoint = serviceEndpoint(env.SPRING_CREDIT_PAYMENT_WSDL_URL || env.SPRING_XML_WSDL_URL);
  const configured = Boolean(endpoint && env.SPRING_XML_USERNAME && env.SPRING_XML_PASSWORD);
  const enabled = env.SPRING_CREDIT_PAYMENT_ENABLED === 'true';
  return {
    creditPaymentEnabled: enabled,
    creditPaymentReady: enabled && configured,
    creditPayment: 'payInCredit4OTA (XML/SOAP)'
  };
}

export function createSpringSoapClient(env = process.env, fetchImpl = fetch) {
  const endpoint = serviceEndpoint(env.SPRING_CREDIT_PAYMENT_WSDL_URL || env.SPRING_XML_WSDL_URL);
  const username = String(env.SPRING_XML_USERNAME || '').trim();
  const password = String(env.SPRING_XML_PASSWORD || '').trim();

  async function payInCredit4OTA({ orderNo, orderMoney, moneyClassId = 0, orderType = 0 }) {
    if (env.SPRING_CREDIT_PAYMENT_ENABLED !== 'true') {
      throw new Error('Spring credit payment is disabled on this server.');
    }
    if (!endpoint || !username || !password) {
      throw new Error('Spring XML credit-payment configuration is incomplete on this server.');
    }
    const money = finiteNumber(orderMoney);
    const currencyId = finiteNumber(moneyClassId);
    const type = finiteNumber(orderType);
    if (!String(orderNo || '').trim() || money === null || money < 0 || currencyId === null || type === null) {
      throw new Error('A valid Spring order number, amount, currency and order type are required.');
    }

    const body = `<?xml version="1.0" encoding="utf-8"?>\n<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">\n  <soap:Body>\n    <i:payInCredit4OTA xmlns:i="http://wsinterface.remoteservice.booking.springairlines.com/">\n      <paymentInfo>\n        <usernameToken><password>${xmlEscape(password)}</password><username>${xmlEscape(username)}</username></usernameToken>\n        <moneyClassId>${currencyId}</moneyClassId>\n        <orderMoney>${money}</orderMoney>\n        <orderNo>${xmlEscape(String(orderNo).trim())}</orderNo>\n        <orderType>${type}</orderType>\n      </paymentInfo>\n    </i:payInCredit4OTA>\n  </soap:Body>\n</soap:Envelope>`;

    let response;
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'text/xml; charset=utf-8',
          accept: 'text/xml, application/xml, */*',
          SOAPAction: '""'
        },
        body
      });
    } catch {
      throw new Error('Spring credit payment network request failed.');
    }

    const responseXml = await response.text();
    const result = {
      ifSuccess: xmlValue(responseXml, 'ifSuccess'),
      errCode: xmlValue(responseXml, 'errCode'),
      errMsg: xmlValue(responseXml, 'errMsg')
    };
    if (!response.ok || result.ifSuccess !== 'Y') {
      const detail = result.errMsg || `Spring credit payment failed (${response.status}).`;
      throw new Error(`Spring credit payment failed${result.errCode ? ` (${result.errCode})` : ''}: ${detail}`);
    }
    return result;
  }

  return { payInCredit4OTA };
}
