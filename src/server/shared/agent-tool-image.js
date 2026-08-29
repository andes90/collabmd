import sharp from 'sharp';

export async function encodeAgentToolImage(value) {
  const { format, svg } = value;
  const metadata = { ...value };
  delete metadata.format;
  delete metadata.scene;
  delete metadata.svg;
  const mimeType = format === 'svg' ? 'image/svg+xml' : 'image/png';
  const image = format === 'svg'
    ? Buffer.from(svg)
    : await sharp(Buffer.from(svg)).png().toBuffer();
  return {
    data: image.toString('base64'),
    mimeType,
    structuredContent: {
      ...metadata,
      format,
      mimeType,
    },
  };
}
