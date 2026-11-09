/**
 * Ações de prospecção que um token com `mcp:write` pode chamar.
 * Iniciar e retomar enviam e ficam de fora: o cartão da tela é quem liga a fila.
 */
export const ACOES_ABERTAS_AO_TOKEN = new Set<string>(["configure", "search", "pause", "seed_list"]);
