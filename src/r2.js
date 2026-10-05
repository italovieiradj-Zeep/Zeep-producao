const { S3Client, ListObjectsV2Command, GetObjectCommand, HeadObjectCommand, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { parseBuffer } = require('music-metadata');

const s3Client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const BUCKET = process.env.R2_BUCKET_NAME;

async function listFiles(prefix = '') {
  const command = new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix });
  const response = await s3Client.send(command);
  return response.Contents || [];
}

async function getPreviewUrl(key) {
  const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  return getSignedUrl(s3Client, command, { expiresIn: 3600 });
}

async function downloadRange(key, range) {
  const command = new GetObjectCommand({ Bucket: BUCKET, Key: key, Range: range });
  const response = await s3Client.send(command);
  const chunks = [];
  for await (const chunk of response.Body) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function downloadFull(key) {
  const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  const response = await s3Client.send(command);
  const chunks = [];
  for await (const chunk of response.Body) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function extractMeta(metadata) {
  return {
    title: metadata.common.title || null,
    artist: metadata.common.artist || null,
    album: metadata.common.album || null,
    genre: Array.isArray(metadata.common.genre) ? metadata.common.genre[0] : (metadata.common.genre || null),
    duration: metadata.format.duration || null,
  };
}

// Considera completo quando tem título/artista E duração
function isComplete(meta) {
  return !!(meta.title || meta.artist) && meta.duration !== null;
}

// Fallback: deriva do nome do arquivo ("Artista - Título")
function fromFileName(key) {
  const name = key.split('/').pop().replace(/\.[^.]+$/, '');
  const parts = name.split(' - ');
  return {
    title: parts.slice(1).join(' - ') || name,
    artist: parts[0] || null,
    album: null,
    genre: null,
    duration: null,
  };
}

// LEITURA PROGRESSIVA — extrai metadados de forma definitiva
async function getMetadata(key, fileSize) {
  // 1ª tentativa: 512KB início + 512KB fim, informando o tamanho total.
  // Com fileSize, o parser calcula a duração correta sem baixar tudo.
  try {
    const head = await downloadRange(key, 'bytes=0-524287');
    const tail = await downloadRange(key, 'bytes=-524288');
    const combined = Buffer.concat([head, tail]);
    const meta = extractMeta(await parseBuffer(combined, { fileSize }));
    if (isComplete(meta)) return meta;
  } catch (err) { /* segue para a leitura completa */ }

  // 2ª tentativa: arquivo inteiro — resolve M4A com moov grande e WAV difíceis
  try {
    const full = await downloadFull(key);
    const meta = extractMeta(await parseBuffer(full, { fileSize }));
    if (isComplete(meta)) return meta;
  } catch (err) { /* segue para o fallback */ }

  // 3ª opção: deriva do nome do arquivo (nenhuma música fica sem título)
  return fromFileName(key);
}

// Calcula quantos bytes correspondem a X segundos de áudio
function bytesForSeconds(fileSize, duration, seconds) {
  if (!fileSize || !duration || duration <= 0) return null;
  const bytesPerSecond = fileSize / duration;
  return Math.floor(bytesPerSecond * seconds);
}

// Gera URL de preview de 15s usando Range Request
async function getPreview15sUrl(key, fileSize, duration) {
  const seconds = 15;
  const rangeBytes = bytesForSeconds(fileSize, duration, seconds);

  // Se não temos duração, serve o arquivo inteiro (fallback seguro)
  if (!rangeBytes) {
    const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
    return getSignedUrl(s3Client, command, { expiresIn: 3600 });
  }

  // Gera URL assinada com Range: só os primeiros 15 segundos
  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Range: `bytes=0-${rangeBytes - 1}`,
  });
  return getSignedUrl(s3Client, command, { expiresIn: 3600 });
}

// Baixa um objeto do R2 respeitando o Range recebido (retorna a resposta completa)
async function getObjectStream(key, rangeHeader) {
  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ...(rangeHeader ? { Range: rangeHeader } : {}),
  });
  return s3Client.send(command);
}

// Pega o tamanho do arquivo sem baixar o conteúdo (HEAD)
async function headObject(key) {
  const command = new HeadObjectCommand({ Bucket: BUCKET, Key: key });
  const response = await s3Client.send(command);
  return response;
}

// Faz upload de um objeto para o R2
async function putObject(key, body, contentType) {
  await s3Client.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: contentType }));
}

// ★ NOVO: remove um objeto do R2 (usado pelo DELETE /api/r2/music/:key)
async function deleteObject(key) {
  await s3Client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

module.exports = { listFiles, getPreviewUrl, getMetadata, getPreview15sUrl, getObjectStream, headObject, putObject, deleteObject, BUCKET };