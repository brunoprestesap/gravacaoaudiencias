import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfkit lê arquivos .afm de node_modules em runtime via fs.readFileSync;
  // se for empacotado, o caminho resolve para "/ROOT/..." e quebra. Manter
  // como pacote externo no servidor faz o Node carregar diretamente.
  serverExternalPackages: ["pdfkit"],
  // Suite e2e roda contra 127.0.0.1 para casar com cookies do storageState.
  // Sem isso, Next 16 dev bloqueia /_next/webpack-hmr e a página fica sem JS.
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
