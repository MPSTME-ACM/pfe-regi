import qrcode from 'qrcode';
const qrCodeDataUrl = await qrcode.toDataURL(`https://register.pfe.mpstmeacm.com/verify?orderId=orderid`);
console.log(qrCodeDataUrl);