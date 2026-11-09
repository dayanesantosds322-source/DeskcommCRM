/**
 * Grava uma lista pronta como campanha em rascunho.
 *
 * Status `draft` e busca `succeeded` de propósito: o worker só envia
 * `running` e só sincroniza busca `starting`/`running`. Não há run de
 * provedor, não há contato e não há mensagem. Repetir o mesmo
 * `request_id` devolve a campanha que já existe.
 */
import type pg from "pg";

import { ProspectingError } from "./provider";
import { withProspectingLock } from "./store";
import {
  FUSO_DA_LISTA,
  instanteNoFuso,
  prepararLista,
  type CandidatoDaLista,
  type EmpresaDaLista,
  type JanelaDaLista,
} from "./lista-pronta";

export interface PedidoDeRascunho {
  requestId: string;
  nome: string;
  empresas: readonly EmpresaDaLista[];
  ritmo: { daily_limit: number; interval_minutes: number };
  janela: JanelaDaLista;
  instrucao: string;
  agenteId?: string | null;
}

export interface RascunhoGravado {
  id: string;
  status: "draft";
  search_status: "succeeded";
  inseridos: number;
  ja_existia: boolean;
  envio: false;
  disparo: "aguardando_cartao";
  whatsapp_confirmado: false;
  consentimento: "nao_coletado";
}

function dadoDoCandidato(c: CandidatoDaLista) {
  return {
    key: c.placeId,
    name: c.nome,
    phone: c.telefone,
    website: c.fonte,
    category: c.segmento,
    address: c.endereco,
    maps_url: c.fonte,
    rating: null,
    reviews: null,
    emails: [],
    socials: [],
    whatsapp_confirmado: false,
    consentimento: "nao_coletado",
  };
}

export async function criarRascunhoDeLista(
  pool: pg.Pool,
  org: string,
  pedido: PedidoDeRascunho,
): Promise<RascunhoGravado> {
  const candidatos = prepararLista(pedido.empresas);
  if (pedido.janela.fim < pedido.janela.inicio) {
    throw new ProspectingError("A data final da lista é anterior à inicial.", 422);
  }
  return withProspectingLock(pool, org, async (db) => {
    const previo = await db.query<{ id: string; status: string; search_status: string }>(
      "select id, status, search_status from prospecting_campaigns where organization_id=$1 and request_id=$2",
      [org, pedido.requestId],
    );
    if (previo.rows[0]) {
      if (previo.rows[0].status !== "draft") {
        throw new ProspectingError("Esta lista já virou campanha e não é regravada por aqui.", 409);
      }
      return {
        id: previo.rows[0].id,
        status: "draft",
        search_status: "succeeded",
        inseridos: 0,
        ja_existia: true,
        envio: false,
        disparo: "aguardando_cartao",
        whatsapp_confirmado: false,
        consentimento: "nao_coletado",
      };
    }
    if (pedido.agenteId) {
      const agente = await db.query(
        "select id from ai_agents where organization_id=$1 and id=$2 and archived_at is null",
        [org, pedido.agenteId],
      );
      if (!agente.rows[0]) throw new ProspectingError("Agente não encontrado nesta organização.", 404);
    }
    const search = {
      origem: "lista_pronta",
      name: pedido.nome,
      niche: "lista pronta",
      location: pedido.janela.fuso || FUSO_DA_LISTA,
      limit: candidatos.length,
      janela: pedido.janela,
      ritmo: pedido.ritmo,
      instrucao_rascunho: pedido.instrucao,
      agente_id: pedido.agenteId ?? null,
      whatsapp_confirmado: false,
      consentimento: "nao_coletado",
    };
    const criada = await db.query<{ id: string }>(
      `insert into prospecting_campaigns(
         organization_id, request_id, name, search, config, status, search_status, next_send_at
       ) values ($1,$2,$3,$4,null,'draft','succeeded',$5) returning id`,
      [org, pedido.requestId, pedido.nome, search, inicioDaJanela(pedido.janela)],
    );
    const id = criada.rows[0]!.id;
    let inseridos = 0;
    for (const candidato of candidatos) {
      const gravou = await db.query(
        "insert into prospecting_candidates(organization_id,campaign_id,place_id,phone,data) values($1,$2,$3,$4,$5) on conflict do nothing",
        [org, id, candidato.placeId, candidato.telefone, dadoDoCandidato(candidato)],
      );
      inseridos += gravou.rowCount ?? 0;
    }
    await db.query(
      "update prospecting_campaigns set result_count=$3, skipped_count=$4, updated_at=now() where organization_id=$1 and id=$2",
      [org, id, inseridos, candidatos.length - inseridos],
    );
    return {
      id,
      status: "draft",
      search_status: "succeeded",
      inseridos,
      ja_existia: false,
      envio: false,
      disparo: "aguardando_cartao",
      whatsapp_confirmado: false,
      consentimento: "nao_coletado",
    };
  });
}

function inicioDaJanela(janela: JanelaDaLista): Date {
  return instanteNoFuso(janela.inicio, "09:00", janela.fuso);
}
