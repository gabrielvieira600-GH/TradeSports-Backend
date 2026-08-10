const { v2: cloudinary } = require('cloudinary');

function configurarCloudinary() {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    const erro = new Error('O serviço de imagens não está configurado.');
    erro.code = 'CLOUDINARY_NOT_CONFIGURED';
    throw erro;
  }

  cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret });
  return cloudinary;
}

module.exports = { configurarCloudinary };
