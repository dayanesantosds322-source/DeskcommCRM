/**
 * MCP write — rascunho de campanha a partir de uma lista já pronta.
 *
 * Não pesquisa de novo, não publica agente, não abre conversa e não envia.
 * O token de leitura não passa: `requiresScope` é `mcp:write`. O disparo
 * continua no cartão da tela, ação fechada ao token.
 */
import { z } from "zod";

import { getRequestPool } from "@/lib/agent-engine/db/request-pool";
import { criarRascunhoDeLista } from "@/lib/prospecting/rascunho-de-lista";

import type { McpToolDefinition } from "../types";

const inputShape = {
  request_id: z.string().uuid(),
  nome: z.string().trim().min(2).max(120),
  empresas: z
    .array(
      z
        .object({
          nome: z.string().trim().min(2).max(200),
          telefone: z.string().trim().min(8).max(20),
          fonte: z.string().trim().max(500).nullable().optional(),
          segmento: z.string().trim().max(120).nullable().optional(),
          endereco: z.string().trim().max(300).nullable().optional(),
        })
        .strict(),
    )
    .min(1)
    .max(100),
  daily_limit: z.number().int().min(1).max(50),
  interval_minutes: z.number().int().min(5).max(1440),
  inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  fim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  fuso: z.string().trim().min(3).max(64).default("America/Manaus"),
  instrucao: z.string().trim().min(10).max(4000),
  agente_id: z.string().uuid().nullable().optional(),
};

export const crmCreateProspectingListDraft: McpToolDefinition<typeof inputShape> = {
  name: "crm_create_prospecting_list_draft",
  description:
    "Grava uma lista de empresas já escolhida como campanha em rascunho. Não pesquisa, " +
    "não publica o agente e não envia mensagem. O início das abordagens continua na tela, " +
    "no cartão de revisão. Repetir o mesmo request_id devolve o rascunho já gravado.",
  inputSchema: inputShape,
  category: "write",
  requiresRole: "admin",
  requiresScope: "mcp:write",
  redigirParaAuditoria: (args) => ({
    request_id: args.request_id,
    quantidade: Array.isArray(args.empresas) ? args.empresas.length : 0,
    daily_limit: args.daily_limit,
    inicio: args.inicio,
    fim: args.fim,
  }),
  handler: async (input, ctx) => {
    const rascunho = await criarRascunhoDeLista(getRequestPool(), ctx.organizationId, {
      requestId: input.request_id,
      nome: input.nome,
      empresas: input.empresas,
      ritmo: { daily_limit: input.daily_limit, interval_minutes: input.interval_minutes },
      janela: { inicio: input.inicio, fim: input.fim, fuso: input.fuso },
      instrucao: input.instrucao,
      agenteId: input.agente_id ?? null,
    });
    return rascunho;
  },
};
