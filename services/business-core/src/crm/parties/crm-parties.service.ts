import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PoolClient } from "pg";
import { RequestActor } from "../../auth/actor";
import { WorkspaceAccessService } from "../../workspaces/workspace-access.service";
import { CrmEventsService } from "../shared/crm-events.service";
import {
  decodeCursor,
  encodeCursor,
  normalizeEmail,
  normalizeLoosePhone,
  normalizeName,
} from "../shared/crm-types";
import {
  AddressInputDto,
  ArchivePartyDto,
  ContactPointInputDto,
  CreatePartyDto,
  CreateRelationshipDto,
  ExportPartiesDto,
  ListPartiesQueryDto,
  MergePartiesDto,
  PrivacyErasePartyDto,
  ReverseMergeDto,
  UpdateAddressDto,
  UpdateContactPointDto,
  UpdatePartyDto,
  UpdateRelationshipDto,
  UpsertConsentDto,
} from "./dto/parties.dto";
import { queryClientTimeline } from "../shared/client-timeline";
import { refreshEnquiryTitlesForParty } from "../leads/enquiry-title";

interface RelocationRecord { id: string; version: number }
interface StakeholderRelocation { opportunityId: string; role: string }
interface MergeRelocations {
  tables: Record<string, RelocationRecord[]>;
  relationshipsFrom: RelocationRecord[];
  relationshipsTo: RelocationRecord[];
  stakeholders: StakeholderRelocation[];
}

@Injectable()
export class CrmPartiesService {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly events: CrmEventsService,
  ) {}

  list(actor: RequestActor, workspaceId: string, query: ListPartiesQueryDto) {
    return this.access.withPermission(actor, workspaceId, "crm.parties.view", async (client) => {
      const cursor = decodeCursor(query.cursor);
      if (query.cursor && !cursor) throw new BadRequestException("Invalid page cursor");
      const values: unknown[] = [workspaceId];
      const clauses = ["party.workspace_id = $1"];
      if (!query.includeArchived) clauses.push("party.status <> 'archived'");
      if (query.type) {
        values.push(query.type);
        clauses.push(`party.type = $${values.length}::crm_party_type`);
      }
      if (query.lifecycle) {
        values.push(query.lifecycle);
        clauses.push(`party.lifecycle = $${values.length}`);
      }
      if (query.ownerMembershipId) {
        values.push(query.ownerMembershipId);
        clauses.push(`party.owner_membership_id = $${values.length}`);
      }
      if (query.search) {
        values.push(normalizeName(query.search));
        clauses.push(`(
          party.normalized_name % $${values.length}
          OR party.normalized_name LIKE '%' || $${values.length} || '%'
          OR EXISTS (
            SELECT 1 FROM crm_contact_points contact
            WHERE contact.party_id = party.id
              AND contact.workspace_id = party.workspace_id
              AND contact.normalized_value LIKE '%' || $${values.length} || '%'
          )
        )`);
      }
      if (cursor) {
        values.push(cursor.value, cursor.id);
        clauses.push(`(party.normalized_name, party.id) > ($${values.length - 1}, $${values.length}::uuid)`);
      }
      values.push(query.limit + 1);
      const result = await client.query(
        `SELECT party.id, party.type, party.display_name AS "displayName",
                party.lifecycle, party.status,
                party.owner_membership_id AS "ownerMembershipId",
                party.preferred_locale AS "preferredLocale",
                party.preferred_timezone AS "preferredTimezone",
                party.version, party.created_at AS "createdAt", party.updated_at AS "updatedAt",
                COALESCE(jsonb_agg(jsonb_build_object(
                  'id', contact.id, 'type', contact.type, 'rawValue', contact.raw_value,
                  'normalizedValue', contact.normalized_value, 'isPrimary', contact.is_primary,
                  'isVerified', contact.is_verified
                ) ORDER BY contact.is_primary DESC, contact.created_at)
                FILTER (WHERE contact.id IS NOT NULL), '[]'::jsonb) AS contacts
         FROM crm_parties party
         LEFT JOIN crm_contact_points contact
           ON contact.workspace_id = party.workspace_id AND contact.party_id = party.id
          AND contact.status = 'active'
         WHERE ${clauses.join(" AND ")}
         GROUP BY party.id
         ORDER BY party.normalized_name, party.id
         LIMIT $${values.length}`,
        values,
      );
      const hasMore = result.rows.length > query.limit;
      const data = hasMore ? result.rows.slice(0, query.limit) : result.rows;
      const last = data.at(-1) as { id: string; displayName: string } | undefined;
      return {
        data,
        nextCursor: hasMore && last
          ? encodeCursor({ value: normalizeName(last.displayName), id: last.id })
          : null,
      };
    });
  }

  get(actor: RequestActor, workspaceId: string, partyId: string) {
    return this.access.withPermission(actor, workspaceId, "crm.parties.view", async (client, actorUser) => {
      const party = await this.partyAggregate(client, workspaceId, partyId);
      const communications = await this.access.hasPermission(client, workspaceId, actorUser.userId, "crm.communications.view");
      const activities = await this.access.hasPermission(client, workspaceId, actorUser.userId, "crm.activities.view");
      const cases = await client.query<{ id: string }>(
        `SELECT DISTINCT case_link.record_id AS id
           FROM job_identity_links party_link
           JOIN job_identity_links case_link
             ON case_link.workspace_id=party_link.workspace_id AND case_link.job_id=party_link.job_id
            AND case_link.record_type='case' AND case_link.status='active'
          WHERE party_link.workspace_id=$1 AND party_link.status='active' AND (
            (party_link.record_type='enquiry' AND EXISTS (SELECT 1 FROM crm_enquiries record WHERE record.workspace_id=$1 AND record.id::text=party_link.record_id AND record.party_id=$2)) OR
            (party_link.record_type='lead' AND EXISTS (SELECT 1 FROM crm_leads record WHERE record.workspace_id=$1 AND record.id::text=party_link.record_id AND record.party_id=$2)) OR
            (party_link.record_type='opportunity' AND EXISTS (SELECT 1 FROM crm_opportunities record WHERE record.workspace_id=$1 AND record.id::text=party_link.record_id AND record.party_id=$2))
          )`,
        [workspaceId, partyId],
      );
      return {
        ...party,
        clientTimeline: communications || activities ? await queryClientTimeline(client, {
          workspaceId,
          partyId,
          caseIds: cases.rows.map((row) => row.id),
          includeMessages: communications,
          includeActivities: activities,
        }) : [],
        clientTimelineAccess: { communications, activities },
      };
    });
  }

  create(actor: RequestActor, workspaceId: string, input: CreatePartyDto) {
    return this.access.withPermission(actor, workspaceId, "crm.parties.manage", async (client, actorUser) => {
      await this.assertScopedReferences(client, workspaceId, input);
      this.assertProfile(input);
      this.assertPrimarySelections(input);
      const partyId = randomUUID();
      await client.query(
        `INSERT INTO crm_parties
          (id, workspace_id, legal_entity_id, business_unit_id, type, display_name,
           normalized_name, owner_membership_id, preferred_locale, preferred_timezone, created_by)
         VALUES ($1, $2, $3, $4, $5::crm_party_type, $6, $7, $8, $9, $10, $11)`,
        [
          partyId, workspaceId, input.legalEntityId ?? null, input.businessUnitId ?? null,
          input.type, input.displayName.trim(), normalizeName(input.displayName),
          input.ownerMembershipId ?? null, input.preferredLocale ?? null,
          input.preferredTimezone ?? null, actorUser.userId,
        ],
      );
      if (input.type === "person") {
        await client.query(
          `INSERT INTO crm_person_profiles
            (party_id, workspace_id, given_name, family_name, job_title)
           VALUES ($1, $2, $3, $4, $5)`,
          [partyId, workspaceId, input.givenName ?? null, input.familyName ?? null, input.jobTitle ?? null],
        );
      } else if (input.type === "organization") {
        await client.query(
          `INSERT INTO crm_organization_profiles
            (party_id, workspace_id, legal_name, website_domain, industry)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            partyId, workspaceId, input.legalName ?? null,
            input.websiteDomain?.trim().toLowerCase() ?? null, input.industry ?? null,
          ],
        );
      }
      for (const contact of input.contacts ?? []) {
        await this.insertContact(client, workspaceId, partyId, contact);
      }
      for (const address of input.addresses ?? []) {
        await client.query(
          `INSERT INTO crm_addresses
            (workspace_id, party_id, label, line1, line2, locality, region,
             postal_code, country_code, is_primary)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, upper($9), $10)`,
          [
            workspaceId, partyId, address.label ?? null, address.line1 ?? null,
            address.line2 ?? null, address.locality ?? null, address.region ?? null,
            address.postalCode ?? null, address.countryCode, address.isPrimary ?? false,
          ],
        );
      }
      const response = await this.partyAggregate(client, workspaceId, partyId);
      await this.events.record(client, {
        workspaceId, actorUserId: actorUser.userId, source: "user",
        action: "crm.party.created.v1", entityType: "crm_party", entityId: partyId,
        after: response,
      });
      return response;
    });
  }

  update(actor: RequestActor, workspaceId: string, partyId: string, input: UpdatePartyDto) {
    return this.access.withPermission(actor, workspaceId, "crm.parties.manage", async (client, actorUser) => {
      const before = await this.partyAggregate(client, workspaceId, partyId, true);
      if (before.status !== "active") throw new ConflictException("Only active parties can be edited");
      if (input.ownerMembershipId) {
        await this.requireMembership(client, workspaceId, input.ownerMembershipId);
      }
      this.assertUpdateProfile(String(before.type), input);
      const result = await client.query(
        `UPDATE crm_parties SET
           display_name = COALESCE($1, display_name),
           normalized_name = CASE WHEN $1 IS NULL THEN normalized_name ELSE $2 END,
           lifecycle = COALESCE($3, lifecycle),
           owner_membership_id = CASE WHEN $4::boolean THEN $5::uuid ELSE owner_membership_id END,
           preferred_locale = CASE WHEN $6::boolean THEN $7 ELSE preferred_locale END,
           preferred_timezone = CASE WHEN $8::boolean THEN $9 ELSE preferred_timezone END,
           version = version + 1
         WHERE id = $10 AND workspace_id = $11 AND version = $12 AND status = 'active'
         RETURNING id`,
        [
          input.displayName?.trim() ?? null,
          input.displayName ? normalizeName(input.displayName) : null,
          input.lifecycle ?? null,
          input.ownerMembershipId !== undefined, input.ownerMembershipId ?? null,
          input.preferredLocale !== undefined, input.preferredLocale ?? null,
          input.preferredTimezone !== undefined, input.preferredTimezone ?? null,
          partyId, workspaceId, input.version,
        ],
      );
      if (!result.rowCount) throw new ConflictException("Party changed; reload and try again");
      if (input.displayName && input.displayName.trim() !== before.displayName) {
        await refreshEnquiryTitlesForParty(client, workspaceId, partyId, input.displayName);
      }
      if (before.type === "person") {
        await client.query(
          `UPDATE crm_person_profiles SET
             given_name = CASE WHEN $1::boolean THEN $2 ELSE given_name END,
             family_name = CASE WHEN $3::boolean THEN $4 ELSE family_name END,
             job_title = CASE WHEN $5::boolean THEN $6 ELSE job_title END,
             updated_at = now()
           WHERE workspace_id = $7 AND party_id = $8`,
          [
            input.givenName !== undefined, input.givenName?.trim() || null,
            input.familyName !== undefined, input.familyName?.trim() || null,
            input.jobTitle !== undefined, input.jobTitle?.trim() || null,
            workspaceId, partyId,
          ],
        );
      } else if (before.type === "organization") {
        await client.query(
          `UPDATE crm_organization_profiles SET
             legal_name = CASE WHEN $1::boolean THEN $2 ELSE legal_name END,
             website_domain = CASE WHEN $3::boolean THEN $4 ELSE website_domain END,
             industry = CASE WHEN $5::boolean THEN $6 ELSE industry END,
             updated_at = now()
           WHERE workspace_id = $7 AND party_id = $8`,
          [
            input.legalName !== undefined, input.legalName?.trim() || null,
            input.websiteDomain !== undefined, input.websiteDomain?.trim().toLowerCase() || null,
            input.industry !== undefined, input.industry?.trim() || null,
            workspaceId, partyId,
          ],
        );
      }
      const response = await this.partyAggregate(client, workspaceId, partyId);
      await this.events.record(client, {
        workspaceId, actorUserId: actorUser.userId, source: "user",
        action: "crm.party.updated.v1", entityType: "crm_party", entityId: partyId,
        before, after: response,
      });
      return response;
    });
  }

  addContact(
    actor: RequestActor,
    workspaceId: string,
    partyId: string,
    input: ContactPointInputDto,
  ) {
    return this.access.withPermission(actor, workspaceId, "crm.parties.manage", async (client, actorUser) => {
      await this.requireParty(client, workspaceId, partyId, true);
      const contact = await this.insertContact(client, workspaceId, partyId, input);
      await this.events.record(client, {
        workspaceId, actorUserId: actorUser.userId, source: "user",
        action: "crm.contact_point.created.v1", entityType: "crm_party", entityId: partyId,
        after: contact,
      });
      return contact;
    });
  }

  updateContact(
    actor: RequestActor,
    workspaceId: string,
    partyId: string,
    contactId: string,
    input: UpdateContactPointDto,
  ) {
    return this.access.withPermission(actor, workspaceId, "crm.parties.manage", async (client, actorUser) => {
      await this.requireParty(client, workspaceId, partyId, true);
      const existing = await client.query<Record<string, unknown>>(
        `SELECT * FROM crm_contact_points
         WHERE workspace_id = $1 AND party_id = $2 AND id = $3 FOR UPDATE`,
        [workspaceId, partyId, contactId],
      );
      if (!existing.rowCount) throw new NotFoundException("Contact point not found");
      const before = existing.rows[0];
      if (Number(before.version) !== input.version) throw new ConflictException("Contact point changed; reload and try again");
      const type = String(before.type);
      const rawValue = input.value?.trim() ?? String(before.raw_value);
      const { normalizedValue, invalidReason } = this.normalizeContact(type, rawValue);
      const nextVerified = input.status === "archived" ? false : input.isVerified ?? Boolean(before.is_verified);
      if (nextVerified && (!normalizedValue || invalidReason)) throw new UnprocessableEntityException("An invalid contact point cannot be verified");
      const nextPrimary = input.status === "archived" ? false : input.isPrimary ?? Boolean(before.is_primary);
      if (nextPrimary) {
        await client.query(
          `UPDATE crm_contact_points SET is_primary = false, version = version + 1, updated_at = now()
           WHERE workspace_id = $1 AND party_id = $2 AND type = $3::crm_contact_point_type AND id <> $4 AND is_primary`,
          [workspaceId, partyId, type, contactId],
        );
      }
      const result = await client.query(
        `UPDATE crm_contact_points SET
           label = CASE WHEN $1::boolean THEN $2 ELSE label END,
           raw_value = $3, normalized_value = $4,
           country_code = CASE WHEN $5::boolean THEN upper($6) ELSE country_code END,
           is_primary = $7, is_verified = $8,
           verified_at = CASE WHEN $8 THEN COALESCE(verified_at, now()) ELSE NULL END,
           invalid_reason = $9,
           status = COALESCE($10::crm_record_status, status),
           version = version + 1, updated_at = now()
         WHERE workspace_id = $11 AND party_id = $12 AND id = $13 AND version = $14
         RETURNING id, type, label, raw_value AS "rawValue", normalized_value AS "normalizedValue",
                   country_code AS "countryCode", is_primary AS "isPrimary", is_verified AS "isVerified",
                   invalid_reason AS "invalidReason", status, version, updated_at AS "updatedAt"`,
        [
          input.label !== undefined, input.label?.trim() || null,
          rawValue, normalizedValue,
          input.countryCode !== undefined, input.countryCode ?? null,
          nextPrimary, nextVerified, invalidReason, input.status ?? null,
          workspaceId, partyId, contactId, input.version,
        ],
      );
      if (!result.rowCount) throw new ConflictException("Contact point changed; reload and try again");
      const response = result.rows[0] as Record<string, unknown>;
      await this.events.record(client, { workspaceId, actorUserId: actorUser.userId, source: "user", action: "crm.contact_point.updated.v1", entityType: "crm_party", entityId: partyId, before, after: response });
      return response;
    });
  }

  addAddress(actor: RequestActor, workspaceId: string, partyId: string, input: AddressInputDto) {
    return this.access.withPermission(actor, workspaceId, "crm.parties.manage", async (client, actorUser) => {
      await this.requireParty(client, workspaceId, partyId, true);
      if (input.isPrimary) await this.clearPrimaryAddresses(client, workspaceId, partyId);
      const result = await client.query(
        `INSERT INTO crm_addresses
          (workspace_id, party_id, label, line1, line2, locality, region, postal_code, country_code, is_primary)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,upper($9),$10)
         RETURNING id, label, line1, line2, locality, region, postal_code AS "postalCode",
                   country_code AS "countryCode", is_primary AS "isPrimary", version,
                   created_at AS "createdAt", updated_at AS "updatedAt"`,
        [workspaceId, partyId, input.label ?? null, input.line1 ?? null, input.line2 ?? null, input.locality ?? null, input.region ?? null, input.postalCode ?? null, input.countryCode, input.isPrimary ?? false],
      );
      const response = result.rows[0] as Record<string, unknown>;
      await this.events.record(client, { workspaceId, actorUserId: actorUser.userId, source: "user", action: "crm.address.created.v1", entityType: "crm_party", entityId: partyId, after: response });
      return response;
    });
  }

  updateAddress(actor: RequestActor, workspaceId: string, partyId: string, addressId: string, input: UpdateAddressDto) {
    return this.access.withPermission(actor, workspaceId, "crm.parties.manage", async (client, actorUser) => {
      await this.requireParty(client, workspaceId, partyId, true);
      const existing = await client.query<Record<string, unknown>>(`SELECT * FROM crm_addresses WHERE workspace_id = $1 AND party_id = $2 AND id = $3 FOR UPDATE`, [workspaceId, partyId, addressId]);
      if (!existing.rowCount) throw new NotFoundException("Address not found");
      const before = existing.rows[0];
      if (Number(before.version) !== input.version) throw new ConflictException("Address changed; reload and try again");
      if (input.isPrimary) await this.clearPrimaryAddresses(client, workspaceId, partyId, addressId);
      const result = await client.query(
        `UPDATE crm_addresses SET
           label = CASE WHEN $1::boolean THEN $2 ELSE label END,
           line1 = CASE WHEN $3::boolean THEN $4 ELSE line1 END,
           line2 = CASE WHEN $5::boolean THEN $6 ELSE line2 END,
           locality = CASE WHEN $7::boolean THEN $8 ELSE locality END,
           region = CASE WHEN $9::boolean THEN $10 ELSE region END,
           postal_code = CASE WHEN $11::boolean THEN $12 ELSE postal_code END,
           country_code = CASE WHEN $13::boolean THEN upper($14) ELSE country_code END,
           is_primary = COALESCE($15, is_primary), version = version + 1, updated_at = now()
         WHERE workspace_id = $16 AND party_id = $17 AND id = $18 AND version = $19
         RETURNING id, label, line1, line2, locality, region, postal_code AS "postalCode",
                   country_code AS "countryCode", is_primary AS "isPrimary", version, updated_at AS "updatedAt"`,
        [
          input.label !== undefined, input.label?.trim() || null,
          input.line1 !== undefined, input.line1?.trim() || null,
          input.line2 !== undefined, input.line2?.trim() || null,
          input.locality !== undefined, input.locality?.trim() || null,
          input.region !== undefined, input.region?.trim() || null,
          input.postalCode !== undefined, input.postalCode?.trim() || null,
          input.countryCode !== undefined, input.countryCode ?? null,
          input.isPrimary ?? null, workspaceId, partyId, addressId, input.version,
        ],
      );
      if (!result.rowCount) throw new ConflictException("Address changed; reload and try again");
      const response = result.rows[0] as Record<string, unknown>;
      await this.events.record(client, { workspaceId, actorUserId: actorUser.userId, source: "user", action: "crm.address.updated.v1", entityType: "crm_party", entityId: partyId, before, after: response });
      return response;
    });
  }

  addRelationship(actor: RequestActor, workspaceId: string, input: CreateRelationshipDto) {
    return this.access.withPermission(actor, workspaceId, "crm.parties.manage", async (client, actorUser) => {
      if (input.fromPartyId === input.toPartyId) {
        throw new UnprocessableEntityException("A party cannot be related to itself");
      }
      await this.requireParty(client, workspaceId, input.fromPartyId, true);
      await this.requireParty(client, workspaceId, input.toPartyId, true);
      const result = await client.query(
        `INSERT INTO crm_relationships
          (workspace_id, from_party_id, to_party_id, type, label, is_primary)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, from_party_id AS "fromPartyId", to_party_id AS "toPartyId",
                   type, label, is_primary AS "isPrimary", version,
                   created_at AS "createdAt", updated_at AS "updatedAt"`,
        [workspaceId, input.fromPartyId, input.toPartyId, input.type, input.label ?? null, input.isPrimary ?? false],
      );
      const response = result.rows[0] as Record<string, unknown>;
      await this.events.record(client, {
        workspaceId, actorUserId: actorUser.userId, source: "user",
        action: "crm.relationship.created.v1", entityType: "crm_relationship",
        entityId: String(response.id), after: response,
      });
      return response;
    });
  }

  updateRelationship(actor: RequestActor, workspaceId: string, relationshipId: string, input: UpdateRelationshipDto) {
    return this.access.withPermission(actor, workspaceId, "crm.parties.manage", async (client, actorUser) => {
      const existing = await client.query<Record<string, unknown>>(`SELECT * FROM crm_relationships WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, relationshipId]);
      if (!existing.rowCount) throw new NotFoundException("Relationship not found");
      const before = existing.rows[0];
      if (Number(before.version) !== input.version) throw new ConflictException("Relationship changed; reload and try again");
      const endedAt = input.endedAt !== undefined ? this.optionalDate(input.endedAt, "endedAt") : before.ended_at;
      const result = await client.query(
        `UPDATE crm_relationships SET
           label = CASE WHEN $1::boolean THEN $2 ELSE label END,
           is_primary = COALESCE($3, is_primary), ended_at = $4,
           version = version + 1, updated_at = now()
         WHERE workspace_id = $5 AND id = $6 AND version = $7
         RETURNING id, from_party_id AS "fromPartyId", to_party_id AS "toPartyId", type,
                   label, is_primary AS "isPrimary", started_at AS "startedAt", ended_at AS "endedAt", version`,
        [input.label !== undefined, input.label?.trim() || null, input.isPrimary ?? null, endedAt, workspaceId, relationshipId, input.version],
      );
      if (!result.rowCount) throw new ConflictException("Relationship changed; reload and try again");
      const response = result.rows[0] as Record<string, unknown>;
      await this.events.record(client, { workspaceId, actorUserId: actorUser.userId, source: "user", action: "crm.relationship.updated.v1", entityType: "crm_relationship", entityId: relationshipId, before, after: response });
      return response;
    });
  }

  upsertConsent(
    actor: RequestActor,
    workspaceId: string,
    partyId: string,
    input: UpsertConsentDto,
  ) {
    return this.access.withPermission(actor, workspaceId, "crm.consent.manage", async (client, actorUser) => {
      await this.requireParty(client, workspaceId, partyId, true);
      if (input.legalEntityId) await this.requireLegalEntity(client, workspaceId, input.legalEntityId);
      const existing = await client.query<Record<string, unknown>>(
        `SELECT id, status, evidence, jurisdiction, expires_at AS "expiresAt", version
         FROM crm_consents
         WHERE workspace_id = $1 AND party_id = $2
           AND legal_entity_id IS NOT DISTINCT FROM $3::uuid
           AND purpose = $4 AND channel = $5
         FOR UPDATE`,
        [workspaceId, partyId, input.legalEntityId ?? null, input.purpose, input.channel],
      );
      if (existing.rowCount && input.version !== undefined && Number(existing.rows[0].version) !== input.version) {
        throw new ConflictException("Consent changed; reload and try again");
      }
      const result = await client.query(
        `INSERT INTO crm_consents
          (workspace_id, party_id, legal_entity_id, purpose, channel, status,
           evidence, jurisdiction, expires_at, withdrawn_at)
         VALUES ($1, $2, $3, $4, $5, $6::crm_consent_status, $7, $8, $9,
                 CASE WHEN $6 = 'withdrawn' THEN now() ELSE NULL END)
         ON CONFLICT (workspace_id, party_id, legal_entity_id, purpose, channel)
         DO UPDATE SET status = EXCLUDED.status, evidence = EXCLUDED.evidence,
           jurisdiction = EXCLUDED.jurisdiction, expires_at = EXCLUDED.expires_at,
           withdrawn_at = CASE WHEN EXCLUDED.status = 'withdrawn' THEN now() ELSE NULL END,
           captured_at = now(), version = crm_consents.version + 1
         RETURNING id, party_id AS "partyId", legal_entity_id AS "legalEntityId",
                   purpose, channel, status, evidence, jurisdiction,
                   captured_at AS "capturedAt", expires_at AS "expiresAt",
                   withdrawn_at AS "withdrawnAt", version`,
        [
          workspaceId, partyId, input.legalEntityId ?? null, input.purpose,
          input.channel, input.status, input.evidence ?? {}, input.jurisdiction ?? null,
          input.expiresAt ?? null,
        ],
      );
      const response = result.rows[0] as Record<string, unknown>;
      await this.events.record(client, {
        workspaceId, actorUserId: actorUser.userId, source: "user",
        action: "crm.consent.changed.v1", entityType: "crm_party",
        entityId: partyId, before: existing.rows[0] ?? null, after: response,
      });
      return response;
    });
  }

  export(actor: RequestActor, workspaceId: string, input: ExportPartiesDto) {
    return this.access.withPermissions(actor, workspaceId, ["crm.parties.view", "crm.parties.export"], async (client, actorUser) => {
      const values: unknown[] = [workspaceId];
      const clauses = ["party.workspace_id = $1"];
      if (!input.includeArchived) clauses.push("party.status <> 'archived'");
      if (input.type) { values.push(input.type); clauses.push(`party.type = $${values.length}::crm_party_type`); }
      if (input.lifecycle) { values.push(input.lifecycle); clauses.push(`party.lifecycle = $${values.length}`); }
      if (input.search) { values.push(normalizeName(input.search)); clauses.push(`party.normalized_name LIKE '%' || $${values.length} || '%'`); }
      const result = await client.query<Record<string, unknown>>(
        `SELECT party.id, party.type, party.display_name AS "displayName", party.lifecycle, party.status,
                party.preferred_locale AS "preferredLocale", party.preferred_timezone AS "preferredTimezone",
                party.created_at AS "createdAt", party.updated_at AS "updatedAt",
                COALESCE((SELECT jsonb_agg(jsonb_build_object('type', contact.type, 'label', contact.label, 'value', contact.raw_value, 'isPrimary', contact.is_primary) ORDER BY contact.is_primary DESC, contact.created_at)
                  FROM crm_contact_points contact WHERE contact.workspace_id = party.workspace_id AND contact.party_id = party.id AND contact.status = 'active'), '[]'::jsonb) AS contacts,
                COALESCE((SELECT jsonb_agg(jsonb_build_object('label', address.label, 'line1', address.line1, 'line2', address.line2, 'locality', address.locality, 'region', address.region, 'postalCode', address.postal_code, 'countryCode', address.country_code, 'isPrimary', address.is_primary) ORDER BY address.is_primary DESC, address.created_at)
                  FROM crm_addresses address WHERE address.workspace_id = party.workspace_id AND address.party_id = party.id), '[]'::jsonb) AS addresses
         FROM crm_parties party WHERE ${clauses.join(" AND ")}
         ORDER BY party.normalized_name, party.id LIMIT 10000`,
        values,
      );
      await this.events.record(client, { workspaceId, actorUserId: actorUser.userId, source: "user", action: "crm.parties.exported.v1", entityType: "crm_party_export", entityId: workspaceId, after: { count: result.rows.length, format: input.format, filters: { type: input.type ?? null, lifecycle: input.lifecycle ?? null, includeArchived: input.includeArchived ?? false } } });
      if (input.format === "csv") {
        const header = ["id", "type", "displayName", "lifecycle", "status", "emails", "phones", "countryCodes", "createdAt"];
        const records = result.rows.map((row) => {
          const contacts = row.contacts as Array<{ type?: string; value?: string }>;
          const addresses = row.addresses as Array<{ countryCode?: string }>;
          return [
            row.id, row.type, row.displayName, row.lifecycle, row.status,
            contacts.filter((contact) => contact.type === "email").map((contact) => contact.value).join("; "),
            contacts.filter((contact) => contact.type === "phone").map((contact) => contact.value).join("; "),
            [...new Set(addresses.map((address) => address.countryCode).filter(Boolean))].join("; "),
            row.createdAt,
          ].map((value) => this.csvCell(value)).join(",");
        });
        return { format: "csv", fileName: `crm-parties-${new Date().toISOString().slice(0, 10)}.csv`, count: result.rows.length, content: [header.join(","), ...records].join("\n") };
      }
      return { format: "json", generatedAt: new Date().toISOString(), count: result.rows.length, data: result.rows };
    });
  }

  archive(actor: RequestActor, workspaceId: string, partyId: string, input: ArchivePartyDto) {
    return this.access.withPermission(actor, workspaceId, "crm.parties.manage", async (client, actorUser) => {
      const before = await this.partyAggregate(client, workspaceId, partyId, true);
      if (before.status !== "active") throw new ConflictException("Only an active party can be archived");
      if (Number(before.version) !== input.version) throw new ConflictException("Party changed; reload and try again");
      const activeWork = await client.query(
        `SELECT
           EXISTS (SELECT 1 FROM crm_opportunities WHERE workspace_id = $1 AND party_id = $2 AND status = 'open') AS "hasOpenOpportunity",
           EXISTS (SELECT 1 FROM crm_leads WHERE workspace_id = $1 AND party_id = $2 AND status IN ('new','attempting_contact','connected','nurturing','paused')) AS "hasActiveLead"`,
        [workspaceId, partyId],
      );
      if (activeWork.rows[0]?.hasOpenOpportunity || activeWork.rows[0]?.hasActiveLead) {
        throw new ConflictException("Close or reassign active leads and opportunities before archiving this customer");
      }
      const result = await client.query(
        `UPDATE crm_parties SET status = 'archived', archived_at = now(), version = version + 1, updated_at = now()
         WHERE workspace_id = $1 AND id = $2 AND version = $3 AND status = 'active' RETURNING id, version, archived_at AS "archivedAt"`,
        [workspaceId, partyId, input.version],
      );
      if (!result.rowCount) throw new ConflictException("Party changed; reload and try again");
      await client.query(`UPDATE crm_sequence_enrollments SET status = 'stopped', exit_reason = 'party_archived', exited_at = now(), next_run_at = NULL, version = version + 1, updated_at = now() WHERE workspace_id = $1 AND party_id = $2 AND status = 'active'`, [workspaceId, partyId]);
      await this.events.record(client, { workspaceId, actorUserId: actorUser.userId, source: "user", action: "crm.party.archived.v1", entityType: "crm_party", entityId: partyId, before: { id: partyId, version: before.version, status: before.status }, after: { ...result.rows[0], reason: input.reason ?? null } });
      return { archived: true, ...result.rows[0] };
    });
  }

  privacyErase(actor: RequestActor, workspaceId: string, partyId: string, input: PrivacyErasePartyDto) {
    return this.access.withPermissions(actor, workspaceId, ["crm.parties.manage", "crm.privacy.erase"], async (client, actorUser) => {
      const before = await this.partyAggregate(client, workspaceId, partyId, true);
      if (before.status === "merged") throw new ConflictException("Erase the surviving customer record instead of a merged record");
      if (Number(before.version) !== input.version) throw new ConflictException("Party changed; reload and try again");
      const replacement = `Erased customer ${partyId.slice(0, 8)}`;

      await client.query(`DELETE FROM crm_message_attachments attachment USING crm_messages message, crm_conversations conversation WHERE attachment.workspace_id = $1 AND attachment.message_id = message.id AND message.conversation_id = conversation.id AND conversation.workspace_id = $1 AND conversation.party_id = $2`, [workspaceId, partyId]);
      await client.query(`UPDATE crm_messages message SET provider_message_id = NULL, body_text = NULL, body_html = NULL, failure_code = NULL, metadata = '{}'::jsonb, version = message.version + 1, updated_at = now() FROM crm_conversations conversation WHERE message.workspace_id = $1 AND conversation.workspace_id = $1 AND message.conversation_id = conversation.id AND conversation.party_id = $2`, [workspaceId, partyId]);
      await client.query(`UPDATE crm_conversations SET provider_thread_id = NULL, subject = 'Erased conversation', version = version + 1, updated_at = now() WHERE workspace_id = $1 AND party_id = $2`, [workspaceId, partyId]);
      await client.query(`UPDATE crm_activities SET title = 'Erased activity', description = NULL, completion_outcome = NULL, version = version + 1, updated_at = now() WHERE workspace_id = $1 AND party_id = $2`, [workspaceId, partyId]);
      await client.query(`UPDATE crm_intake_events intake SET original_payload = '{}'::jsonb, payload_reference = NULL, failure_message = NULL, version = intake.version + 1, updated_at = now() FROM crm_enquiries enquiry WHERE intake.workspace_id = $1 AND enquiry.workspace_id = $1 AND intake.id = enquiry.intake_event_id AND enquiry.party_id = $2`, [workspaceId, partyId]);
      await client.query(`UPDATE crm_attribution_touches attribution SET content = NULL, term = NULL, referrer = NULL, external_click_id = NULL, metadata = '{}'::jsonb FROM crm_enquiries enquiry WHERE attribution.workspace_id = $1 AND enquiry.workspace_id = $1 AND attribution.enquiry_id = enquiry.id AND enquiry.party_id = $2`, [workspaceId, partyId]);
      await client.query(`UPDATE crm_enquiries SET title = 'Erased enquiry', summary = NULL, version = version + 1, updated_at = now() WHERE workspace_id = $1 AND party_id = $2`, [workspaceId, partyId]);
      await client.query(`UPDATE crm_opportunities SET title = 'Erased opportunity', description = NULL, competitor = NULL, version = version + 1, updated_at = now() WHERE workspace_id = $1 AND party_id = $2`, [workspaceId, partyId]);
      await client.query(`UPDATE crm_contact_points SET label = NULL, raw_value = 'redacted:' || id::text, normalized_value = NULL, country_code = NULL, is_primary = false, is_verified = false, verified_at = NULL, invalid_reason = 'privacy_erased', status = 'archived', version = version + 1, updated_at = now() WHERE workspace_id = $1 AND party_id = $2`, [workspaceId, partyId]);
      await client.query(`UPDATE crm_addresses SET label = NULL, line1 = NULL, line2 = NULL, locality = NULL, region = NULL, postal_code = NULL, country_code = 'ZZ', latitude = NULL, longitude = NULL, is_primary = false, version = version + 1, updated_at = now() WHERE workspace_id = $1 AND party_id = $2`, [workspaceId, partyId]);
      await client.query(`UPDATE crm_person_profiles SET given_name = NULL, family_name = NULL, honorific = NULL, job_title = NULL, birthday_month = NULL, birthday_day = NULL, updated_at = now() WHERE workspace_id = $1 AND party_id = $2`, [workspaceId, partyId]);
      await client.query(`UPDATE crm_organization_profiles SET legal_name = NULL, website_domain = NULL, registration_number = NULL, industry = NULL, employee_band = NULL, updated_at = now() WHERE workspace_id = $1 AND party_id = $2`, [workspaceId, partyId]);
      await client.query(`UPDATE crm_relationships SET label = NULL, version = version + 1, updated_at = now() WHERE workspace_id = $1 AND (from_party_id = $2 OR to_party_id = $2)`, [workspaceId, partyId]);
      await client.query(`UPDATE crm_consents SET status = 'withdrawn', evidence = jsonb_build_object('reason', 'privacy_erasure'), withdrawn_at = now(), version = version + 1, updated_at = now() WHERE workspace_id = $1 AND party_id = $2`, [workspaceId, partyId]);
      await client.query(`UPDATE crm_sequence_enrollments SET status = 'stopped', exit_reason = 'privacy_erased', exited_at = now(), next_run_at = NULL, version = version + 1, updated_at = now() WHERE workspace_id = $1 AND party_id = $2 AND status <> 'stopped'`, [workspaceId, partyId]);
      await client.query(`UPDATE notifications SET subject = NULL, body = 'Content erased', deep_link = NULL, version = version + 1, updated_at = now() WHERE workspace_id = $1 AND recipient_type = 'party' AND recipient_id = $2`, [workspaceId, partyId]);
      await client.query(`DELETE FROM crm_custom_field_values WHERE workspace_id = $1 AND ((entity_type = 'party' AND entity_id = $2) OR entity_id IN (SELECT id FROM crm_leads WHERE workspace_id = $1 AND party_id = $2) OR entity_id IN (SELECT id FROM crm_opportunities WHERE workspace_id = $1 AND party_id = $2))`, [workspaceId, partyId]);
      const result = await client.query(
        `UPDATE crm_parties SET display_name = $1, normalized_name = $2, lifecycle = 'erased', status = 'archived', owner_membership_id = NULL, preferred_locale = NULL, preferred_timezone = NULL, archived_at = now(), version = version + 1, updated_at = now()
         WHERE workspace_id = $3 AND id = $4 AND version = $5 RETURNING id, status, lifecycle, version, archived_at AS "archivedAt"`,
        [replacement, normalizeName(replacement), workspaceId, partyId, input.version],
      );
      if (!result.rowCount) throw new ConflictException("Party changed; reload and try again");
      await this.events.record(client, { workspaceId, actorUserId: actorUser.userId, source: "user", action: "crm.party.privacy_erased.v1", entityType: "crm_party", entityId: partyId, after: { ...result.rows[0], reason: input.reason } });
      return { erased: true, ...result.rows[0] };
    });
  }

  merge(actor: RequestActor, workspaceId: string, input: MergePartiesDto) {
    return this.access.withPermission(actor, workspaceId, "crm.parties.merge", async (client, actorUser) => {
      if (input.survivorPartyId === input.mergedPartyId) {
        throw new UnprocessableEntityException("Choose two different parties");
      }
      const ordered = [input.survivorPartyId, input.mergedPartyId].sort();
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${workspaceId}:party-merge:${ordered.join(":")}`]);
      const survivor = await this.partyAggregate(client, workspaceId, input.survivorPartyId, true);
      const merged = await this.partyAggregate(client, workspaceId, input.mergedPartyId, true);
      if (survivor.status !== "active" || merged.status !== "active") {
        throw new ConflictException("Only active parties can be merged");
      }
      await this.assertMergeHasNoCollisions(client, workspaceId, input.survivorPartyId, input.mergedPartyId);
      const relocations = await this.captureRelocations(client, workspaceId, input.mergedPartyId);
      const operationId = randomUUID();
      await client.query(
        `INSERT INTO crm_merge_operations
          (id, workspace_id, survivor_party_id, merged_party_id, field_decisions, snapshot, performed_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [operationId, workspaceId, input.survivorPartyId, input.mergedPartyId, input.fieldDecisions, { survivor, merged, relocations }, actorUser.userId],
      );
      for (const table of [
        "crm_contact_points", "crm_addresses", "crm_consents", "crm_enquiries",
        "crm_leads", "crm_activities", "crm_conversations", "crm_opportunities",
        "crm_sequence_enrollments", "crm_opportunity_stakeholders",
      ]) {
        await client.query(
          `UPDATE ${table} SET party_id = $1 WHERE workspace_id = $2 AND party_id = $3`,
          [input.survivorPartyId, workspaceId, input.mergedPartyId],
        );
      }
      await client.query(
        `UPDATE crm_relationships SET from_party_id = $1
         WHERE workspace_id = $2 AND from_party_id = $3 AND to_party_id <> $1`,
        [input.survivorPartyId, workspaceId, input.mergedPartyId],
      );
      await client.query(
        `UPDATE crm_relationships SET to_party_id = $1
         WHERE workspace_id = $2 AND to_party_id = $3 AND from_party_id <> $1`,
        [input.survivorPartyId, workspaceId, input.mergedPartyId],
      );
      await client.query(
        `UPDATE crm_parties SET status = 'merged', merged_into_party_id = $1,
           version = version + 1
         WHERE id = $2 AND workspace_id = $3`,
        [input.survivorPartyId, input.mergedPartyId, workspaceId],
      );
      await this.events.record(client, {
        workspaceId, actorUserId: actorUser.userId, source: "user",
        action: "crm.party.merged.v1", entityType: "crm_party", entityId: input.survivorPartyId,
        before: { survivor, merged },
        after: { operationId, survivorPartyId: input.survivorPartyId, mergedPartyId: input.mergedPartyId, reason: input.reason ?? null },
      });
      return { operationId, survivor: await this.partyAggregate(client, workspaceId, input.survivorPartyId) };
    });
  }

  reverseMerge(
    actor: RequestActor,
    workspaceId: string,
    operationId: string,
    input: ReverseMergeDto,
  ) {
    return this.access.withPermission(actor, workspaceId, "crm.parties.merge", async (client, actorUser) => {
      const operation = await client.query<Record<string, unknown>>(
        `SELECT * FROM crm_merge_operations
         WHERE id = $1 AND workspace_id = $2 FOR UPDATE`,
        [operationId, workspaceId],
      );
      if (!operation.rowCount) throw new NotFoundException("Merge operation not found");
      const row = operation.rows[0];
      if (row.reversed_at) throw new ConflictException("Merge has already been reversed");
      const snapshot = row.snapshot as { survivor?: Record<string, unknown>; merged?: Record<string, unknown>; relocations?: MergeRelocations };
      const mergedPartyId = String(row.merged_party_id);
      const survivorPartyId = String(row.survivor_party_id);
      const versions = await client.query<{ id: string; version: number }>(
        `SELECT id, version FROM crm_parties
         WHERE workspace_id = $1 AND id = ANY($2::uuid[]) FOR UPDATE`,
        [workspaceId, [survivorPartyId, mergedPartyId]],
      );
      const byId = new Map(versions.rows.map((record) => [record.id, Number(record.version)]));
      if (byId.get(survivorPartyId) !== input.survivorVersion || byId.get(mergedPartyId) !== input.mergedVersion) {
        throw new ConflictException("Parties changed after merge; automatic reversal is unsafe");
      }
      const mergedSnapshot = snapshot.merged;
      if (!mergedSnapshot || !snapshot.relocations) throw new ConflictException("Merge snapshot is incomplete");
      await this.restoreRelocations(client, workspaceId, survivorPartyId, mergedPartyId, snapshot.relocations);
      await client.query(
        `UPDATE crm_parties SET status = 'active', merged_into_party_id = NULL,
           display_name = $1, normalized_name = $2, lifecycle = $3, version = version + 1
         WHERE id = $4 AND workspace_id = $5`,
        [
          mergedSnapshot.displayName, normalizeName(String(mergedSnapshot.displayName)),
          mergedSnapshot.lifecycle, mergedPartyId, workspaceId,
        ],
      );
      await client.query(
        `UPDATE crm_merge_operations SET reversed_at = now(), reversed_by = $1
         WHERE id = $2 AND workspace_id = $3`,
        [actorUser.userId, operationId, workspaceId],
      );
      await this.events.record(client, {
        workspaceId, actorUserId: actorUser.userId, source: "user",
        action: "crm.party.merge_reversed.v1", entityType: "crm_party", entityId: mergedPartyId,
        after: { operationId, survivorPartyId, mergedPartyId, reason: input.reason ?? null },
      });
      return { operationId, reversed: true, party: await this.partyAggregate(client, workspaceId, mergedPartyId) };
    });
  }

  private async insertContact(
    client: PoolClient,
    workspaceId: string,
    partyId: string,
    input: ContactPointInputDto,
  ): Promise<Record<string, unknown>> {
    const { normalizedValue, invalidReason } = this.normalizeContact(input.type, input.value);
    if (input.isVerified && (!normalizedValue || invalidReason)) {
      throw new UnprocessableEntityException("An invalid contact point cannot be verified");
    }
    if (input.isPrimary) {
      await client.query(
        `UPDATE crm_contact_points SET is_primary = false
         WHERE workspace_id = $1 AND party_id = $2 AND type = $3::crm_contact_point_type`,
        [workspaceId, partyId, input.type],
      );
    }
    const result = await client.query(
      `INSERT INTO crm_contact_points
        (workspace_id, party_id, type, label, raw_value, normalized_value,
         country_code, is_primary, is_verified, verified_at, invalid_reason)
       VALUES ($1, $2, $3::crm_contact_point_type, $4, $5, $6, upper($7), $8, $9,
               CASE WHEN $9 THEN now() ELSE NULL END, $10)
       RETURNING id, type, label, raw_value AS "rawValue",
                 normalized_value AS "normalizedValue", country_code AS "countryCode",
                 is_primary AS "isPrimary", is_verified AS "isVerified",
                 invalid_reason AS "invalidReason", version,
                 created_at AS "createdAt", updated_at AS "updatedAt"`,
      [
        workspaceId, partyId, input.type, input.label ?? null, input.value.trim(),
        normalizedValue, input.countryCode ?? null, input.isPrimary ?? false,
        input.isVerified ?? false, invalidReason,
      ],
    );
    return result.rows[0] as Record<string, unknown>;
  }

  private normalizeContact(type: string, rawValue: string) {
    let normalizedValue: string | null = rawValue.trim();
    let invalidReason: string | null = null;
    if (type === "email") {
      normalizedValue = normalizeEmail(rawValue);
      if (!/^\S+@\S+\.\S+$/.test(normalizedValue)) throw new UnprocessableEntityException("Email address is invalid");
    } else if (type === "phone") {
      normalizedValue = normalizeLoosePhone(rawValue);
      if (!normalizedValue) invalidReason = "unresolved_phone";
    }
    return { normalizedValue, invalidReason };
  }

  private async clearPrimaryAddresses(client: PoolClient, workspaceId: string, partyId: string, exceptAddressId?: string) {
    await client.query(
      `UPDATE crm_addresses SET is_primary = false, version = version + 1, updated_at = now()
       WHERE workspace_id = $1 AND party_id = $2 AND is_primary AND ($3::uuid IS NULL OR id <> $3)`,
      [workspaceId, partyId, exceptAddressId ?? null],
    );
  }

  private optionalDate(value: string | null | undefined, field: string): Date | null {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) throw new BadRequestException(`${field} is invalid`);
    return parsed;
  }

  private csvCell(value: unknown) {
    const text = value == null ? "" : value instanceof Date ? value.toISOString() : String(value);
    return `"${text.replaceAll('"', '""')}"`;
  }

  private async partyAggregate(
    client: PoolClient,
    workspaceId: string,
    partyId: string,
    lock = false,
  ): Promise<Record<string, any>> {
    const result = await client.query<Record<string, any>>(
      `SELECT party.id, party.type, party.display_name AS "displayName",
              party.lifecycle, party.status,
              party.legal_entity_id AS "legalEntityId",
              party.business_unit_id AS "businessUnitId",
              party.owner_membership_id AS "ownerMembershipId",
              party.preferred_locale AS "preferredLocale",
              party.preferred_timezone AS "preferredTimezone",
              party.merged_into_party_id AS "mergedIntoPartyId",
              party.version, party.created_at AS "createdAt", party.updated_at AS "updatedAt",
              to_jsonb(person) - 'workspace_id' - 'party_id' AS person,
              to_jsonb(organization) - 'workspace_id' - 'party_id' AS organization,
              COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'id', contact.id, 'type', contact.type, 'label', contact.label,
                'rawValue', contact.raw_value, 'normalizedValue', contact.normalized_value,
                'countryCode', contact.country_code, 'isPrimary', contact.is_primary,
                'isVerified', contact.is_verified, 'invalidReason', contact.invalid_reason,
                'version', contact.version
              ) ORDER BY contact.is_primary DESC, contact.created_at)
              FROM crm_contact_points contact
              WHERE contact.workspace_id = party.workspace_id AND contact.party_id = party.id
                AND contact.status = 'active'), '[]'::jsonb) AS contacts,
              COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'id', address.id, 'label', address.label, 'line1', address.line1,
                'line2', address.line2, 'locality', address.locality, 'region', address.region,
                'postalCode', address.postal_code, 'countryCode', address.country_code,
                'isPrimary', address.is_primary, 'version', address.version
              ) ORDER BY address.is_primary DESC, address.created_at)
              FROM crm_addresses address
              WHERE address.workspace_id = party.workspace_id AND address.party_id = party.id), '[]'::jsonb) AS addresses,
              COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'id', consent.id, 'legalEntityId', consent.legal_entity_id,
                'purpose', consent.purpose, 'channel', consent.channel, 'status', consent.status,
                'evidence', consent.evidence, 'jurisdiction', consent.jurisdiction,
                'expiresAt', consent.expires_at, 'version', consent.version
              ) ORDER BY consent.purpose, consent.channel)
              FROM crm_consents consent
              WHERE consent.workspace_id = party.workspace_id AND consent.party_id = party.id), '[]'::jsonb) AS consents,
              COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'id', relationship.id, 'direction', CASE WHEN relationship.from_party_id = party.id THEN 'outgoing' ELSE 'incoming' END,
                'fromPartyId', relationship.from_party_id, 'fromPartyName', source.display_name,
                'toPartyId', relationship.to_party_id, 'toPartyName', target.display_name,
                'type', relationship.type, 'label', relationship.label, 'isPrimary', relationship.is_primary,
                'startedAt', relationship.started_at, 'endedAt', relationship.ended_at, 'version', relationship.version
              ) ORDER BY relationship.is_primary DESC, relationship.created_at)
              FROM crm_relationships relationship
              JOIN crm_parties source ON source.id = relationship.from_party_id AND source.workspace_id = relationship.workspace_id
              JOIN crm_parties target ON target.id = relationship.to_party_id AND target.workspace_id = relationship.workspace_id
              WHERE relationship.workspace_id = party.workspace_id
                AND (relationship.from_party_id = party.id OR relationship.to_party_id = party.id)), '[]'::jsonb) AS relationships
       FROM crm_parties party
       LEFT JOIN crm_person_profiles person ON person.party_id = party.id
       LEFT JOIN crm_organization_profiles organization ON organization.party_id = party.id
       WHERE party.id = $1 AND party.workspace_id = $2${lock ? " FOR UPDATE OF party" : ""}`,
      [partyId, workspaceId],
    );
    if (!result.rowCount) throw new NotFoundException("Party not found");
    return result.rows[0];
  }

  private async assertMergeHasNoCollisions(
    client: PoolClient,
    workspaceId: string,
    survivorPartyId: string,
    mergedPartyId: string,
  ): Promise<void> {
    const collisions = await client.query<{ kind: string }>(
      `SELECT 'consent' AS kind
       FROM crm_consents source JOIN crm_consents target
         ON target.workspace_id=source.workspace_id AND target.party_id=$2
        AND target.legal_entity_id IS NOT DISTINCT FROM source.legal_entity_id
        AND target.purpose=source.purpose AND target.channel=source.channel
       WHERE source.workspace_id=$1 AND source.party_id=$3
       UNION ALL
       SELECT 'stakeholder' FROM crm_opportunity_stakeholders source
       JOIN crm_opportunity_stakeholders target
         ON target.workspace_id=source.workspace_id AND target.party_id=$2
        AND target.opportunity_id=source.opportunity_id AND target.role=source.role
       WHERE source.workspace_id=$1 AND source.party_id=$3
       UNION ALL
       SELECT 'relationship' FROM crm_relationships source
       JOIN crm_relationships target
         ON target.workspace_id=source.workspace_id AND target.id<>source.id
        AND target.type=source.type
        AND target.from_party_id=CASE WHEN source.from_party_id=$3 THEN $2::uuid ELSE source.from_party_id END
        AND target.to_party_id=CASE WHEN source.to_party_id=$3 THEN $2::uuid ELSE source.to_party_id END
       WHERE source.workspace_id=$1 AND (source.from_party_id=$3 OR source.to_party_id=$3)
       UNION ALL
       SELECT 'direct_relationship' FROM crm_relationships
       WHERE workspace_id=$1 AND ((from_party_id=$2 AND to_party_id=$3) OR (from_party_id=$3 AND to_party_id=$2))
       LIMIT 1`,
      [workspaceId, survivorPartyId, mergedPartyId],
    );
    if (collisions.rowCount) {
      throw new ConflictException(`Resolve duplicate ${collisions.rows[0].kind} records before merging`);
    }
  }

  private async captureRelocations(
    client: PoolClient,
    workspaceId: string,
    mergedPartyId: string,
  ): Promise<MergeRelocations> {
    const tableNames = [
      "crm_contact_points", "crm_addresses", "crm_consents", "crm_enquiries",
      "crm_leads", "crm_activities", "crm_conversations", "crm_opportunities",
      "crm_sequence_enrollments",
    ];
    const tables: Record<string, RelocationRecord[]> = {};
    for (const table of tableNames) {
      const result = await client.query<RelocationRecord>(
        `SELECT id, version FROM ${table} WHERE workspace_id=$1 AND party_id=$2 ORDER BY id`,
        [workspaceId, mergedPartyId],
      );
      tables[table] = result.rows.map((row) => ({ id: row.id, version: Number(row.version) }));
    }
    const from = await client.query<RelocationRecord>(`SELECT id,version FROM crm_relationships WHERE workspace_id=$1 AND from_party_id=$2 ORDER BY id`, [workspaceId, mergedPartyId]);
    const to = await client.query<RelocationRecord>(`SELECT id,version FROM crm_relationships WHERE workspace_id=$1 AND to_party_id=$2 ORDER BY id`, [workspaceId, mergedPartyId]);
    const stakeholders = await client.query<{ opportunity_id: string; role: string }>(`SELECT opportunity_id,role FROM crm_opportunity_stakeholders WHERE workspace_id=$1 AND party_id=$2 ORDER BY opportunity_id,role`, [workspaceId, mergedPartyId]);
    return {
      tables,
      relationshipsFrom: from.rows.map((row) => ({ id: row.id, version: Number(row.version) })),
      relationshipsTo: to.rows.map((row) => ({ id: row.id, version: Number(row.version) })),
      stakeholders: stakeholders.rows.map((row) => ({ opportunityId: row.opportunity_id, role: row.role })),
    };
  }

  private async restoreRelocations(
    client: PoolClient,
    workspaceId: string,
    survivorPartyId: string,
    mergedPartyId: string,
    relocations: MergeRelocations,
  ): Promise<void> {
    for (const [table, records] of Object.entries(relocations.tables)) {
      for (const record of records) {
        const result = await client.query(
          `UPDATE ${table} SET party_id=$1 WHERE workspace_id=$2 AND id=$3 AND party_id=$4 AND version=$5`,
          [mergedPartyId, workspaceId, record.id, survivorPartyId, record.version],
        );
        if (!result.rowCount) throw new ConflictException(`A ${table} record changed after merge; automatic reversal is unsafe`);
      }
    }
    for (const record of relocations.relationshipsFrom) {
      const result = await client.query(`UPDATE crm_relationships SET from_party_id=$1 WHERE workspace_id=$2 AND id=$3 AND from_party_id=$4 AND version=$5`, [mergedPartyId, workspaceId, record.id, survivorPartyId, record.version]);
      if (!result.rowCount) throw new ConflictException("A relationship changed after merge; automatic reversal is unsafe");
    }
    for (const record of relocations.relationshipsTo) {
      const result = await client.query(`UPDATE crm_relationships SET to_party_id=$1 WHERE workspace_id=$2 AND id=$3 AND to_party_id=$4 AND version=$5`, [mergedPartyId, workspaceId, record.id, survivorPartyId, record.version]);
      if (!result.rowCount) throw new ConflictException("A relationship changed after merge; automatic reversal is unsafe");
    }
    for (const stakeholder of relocations.stakeholders) {
      const result = await client.query(`UPDATE crm_opportunity_stakeholders SET party_id=$1 WHERE workspace_id=$2 AND opportunity_id=$3 AND role=$4 AND party_id=$5`, [mergedPartyId, workspaceId, stakeholder.opportunityId, stakeholder.role, survivorPartyId]);
      if (!result.rowCount) throw new ConflictException("A stakeholder changed after merge; automatic reversal is unsafe");
    }
  }

  private async requireParty(client: PoolClient, workspaceId: string, partyId: string, lock: boolean) {
    const result = await client.query(
      `SELECT id FROM crm_parties
       WHERE id = $1 AND workspace_id = $2 AND status = 'active'${lock ? " FOR UPDATE" : ""}`,
      [partyId, workspaceId],
    );
    if (!result.rowCount) throw new NotFoundException("Active party not found");
  }

  private async requireMembership(client: PoolClient, workspaceId: string, membershipId: string) {
    const result = await client.query(
      `SELECT 1 FROM workspace_memberships
       WHERE id = $1 AND workspace_id = $2 AND status = 'active'`,
      [membershipId, workspaceId],
    );
    if (!result.rowCount) throw new UnprocessableEntityException("Owner is not an active workspace member");
  }

  private async requireLegalEntity(client: PoolClient, workspaceId: string, legalEntityId: string) {
    const result = await client.query(
      `SELECT 1 FROM legal_entities
       WHERE id = $1 AND workspace_id = $2 AND status = 'active'`,
      [legalEntityId, workspaceId],
    );
    if (!result.rowCount) throw new UnprocessableEntityException("Legal entity is not active");
  }

  private async assertScopedReferences(client: PoolClient, workspaceId: string, input: CreatePartyDto) {
    if (input.legalEntityId) await this.requireLegalEntity(client, workspaceId, input.legalEntityId);
    if (input.ownerMembershipId) await this.requireMembership(client, workspaceId, input.ownerMembershipId);
    if (input.businessUnitId) {
      const result = await client.query(
        `SELECT 1 FROM business_units
         WHERE id = $1 AND workspace_id = $2 AND status = 'active'
           AND ($3::uuid IS NULL OR legal_entity_id = $3)`,
        [input.businessUnitId, workspaceId, input.legalEntityId ?? null],
      );
      if (!result.rowCount) throw new UnprocessableEntityException("Business unit is not active in the selected legal entity");
    }
  }

  private assertProfile(input: CreatePartyDto) {
    if (input.type !== "person" && (input.givenName || input.familyName || input.jobTitle)) {
      throw new UnprocessableEntityException("Person profile fields require a person party");
    }
    if (input.type !== "organization" && (input.legalName || input.websiteDomain || input.industry)) {
      throw new UnprocessableEntityException("Organization profile fields require an organization party");
    }
  }

  private assertUpdateProfile(type: string, input: UpdatePartyDto) {
    if (type !== "person" && (input.givenName !== undefined || input.familyName !== undefined || input.jobTitle !== undefined)) {
      throw new UnprocessableEntityException("Person profile fields require a person party");
    }
    if (type !== "organization" && (input.legalName !== undefined || input.websiteDomain !== undefined || input.industry !== undefined)) {
      throw new UnprocessableEntityException("Organization profile fields require an organization party");
    }
  }

  private assertPrimarySelections(input: CreatePartyDto) {
    if ((input.addresses ?? []).filter((address) => address.isPrimary).length > 1) {
      throw new UnprocessableEntityException("Only one primary address is allowed");
    }
    const primaries = new Set<string>();
    for (const contact of input.contacts ?? []) {
      if (!contact.isPrimary) continue;
      if (primaries.has(contact.type)) throw new UnprocessableEntityException(`Only one primary ${contact.type} is allowed`);
      primaries.add(contact.type);
    }
  }
}
