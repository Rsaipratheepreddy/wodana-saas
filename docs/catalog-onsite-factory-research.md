# Factory, on-site and hybrid master data

Research checked 7 September 2026 against the tenant reference workbook and primary sources. These are recommendations for the master-data contract, not a quotation engine or permission to apply suggested percentages to tenant records.

## Definitions for Wodana

| Concept | Meaning | Wardrobe example |
| --- | --- | --- |
| Execution route | Where the main fabrication is carried out | Factory-made, site-built, or components split between both |
| Process | A named, measurable activity at its actual location | Panel cutting at factory; alignment and fixing at site |
| Resource | The machine, person, crew or subcontractor doing the work | Edge bander; carpenter and helper |
| Unit / measurement basis | Exactly what the activity measures | Edge length, number of holes, worker hours, installed modules |
| Price | Tenant/supplier amount for that unit, with date, currency and inclusions | Installation per module, excluding material |
| Wastage allowance | Additional consumption for a specified material and method | Board cutting loss, separate from handling labour |
| Site condition | A recorded condition affecting a particular operation | No lift; restricted working hours; wall scribing |
| Logistics | Delivery, unloading, carrying, storage and protection | One vehicle delivery and manual carrying to floor 3 |
| Inclusion | Whether an activity is included in another price | Installation included in a subcontractor's fabrication price |

A factory route can include site installation. Hybrid means assigning actual components/operations to their location. It does not by itself imply a 50/50 split or an average factory/site percentage. Outsourced is a performer choice and does not imply a work location.

## What a site factor should record

If a tenant wants an adjustment factor, record its name, trigger, affected process/resource, basis (additional quantity/time, fixed charge or percentage), value, baseline, unit, inclusion/exclusion and evidence. For example, a carrying adjustment affects delivery handling, not automatically the material price, machining, tax and margin. A productivity adjustment must say whether it multiplies time or output; these are inverse quantities.

Illustration only: a measured 12 worker-hours at a tenant's rate per worker-hour is labour data. If a site condition adds 3 worker-hours, record those separately and explain why. Do not invent a universal crew speed, shift length, wastage percentage or on-site surcharge.

The wardrobe's 8 × 9 ft = 72 sq.ft is its frontal measurement. It is not automatically the board area, laminate consumption, edge-band length, drilling count or installation effort. Keep those definitions separate. Current scope stores the definitions and references; calculation and quotation selection remain deferred.

## Workbook reconciliation

Reviewed sheets 04_ExecutionType, 07_FactoryProcess, 08_OnsiteProcess, 12_ExecutionRule, 13_WastageRule and 14_LogisticsRule directly from WODANA_Detailed_18_New_Masters.xlsx.

- EXEC-FACTORY says site process allowed = No, while SP-CARP-INST and SP-CARP-MOD explicitly support Factory / Hybrid and ER-INST-CAB requires installation for factory modules. Use the detailed installation applicability; do not enforce the blanket prohibition.
- Slash-separated units such as Sq.ft / Day and Sheet / Hour are alternative charging bases, not valid automatic conversions. One price requires one unit.
- Wastage values such as plywood Factory 6%, On-site 10%, Hybrid 8% are workbook suggestions, not measured tenant production data. Preserve their provenance and leave workspace-approved values unset until supplied.
- Distance and floor factors in sheet 14 are suggestions for their named transport/handling scope. They do not establish a multiplier for an entire wardrobe.
- Site fabrication may include installation. Record the inclusion explicitly to avoid charging it again.

## Primary evidence

[Blum REVEGO assembly guidance](https://www.blum.com/ca/en/products/pocketsystems/revego/assembly/) describes workshop pre-assembly followed by transport, positioning, alignment, mounting and final adjustments at the customer's premises. This establishes that production location and installation location can differ; it does not establish generic costs for all furniture.

[RICS NRM 2, October 2021, reissued October 2022](https://www.rics.org/content/dam/ricsglobal/documents/standards/NRM-2_Oct2022_Update.pdf), work section 2 (printed pp. 139–141), treats off-site manufacture together with specified installation information and explicit transport, offloading and placing inclusions. Section 2.5 and work section 1 distinguish project preliminaries and constraints. The software implication is to store scope and inclusion explicitly, so a bundled rate and separate delivery/installation rates cannot silently represent the same work twice. This is a model-design recommendation, not a claim that every Wodana project must adopt UK measurement rules.

[RICS Construction productivity report 2024](https://www.rics.org/news-insights/rics-construction-productivity-report-2024) discusses differing definitions of productivity, including output per worker-hour and worker-hours per unit. It supports choosing an explicit basis and collecting actual data; it supplies no universal furniture installation productivity or site factor.

The CPWD DAR 2023 official publication was located, but its PDF could not be retrieved reliably in this research pass. No numerical rate or factor from it has been imported or treated as verified.

## Current implementation boundary

Existing execution, factory_process, site_process, resource, wastage_rule, logistics_rule and installation_rule records remain unchanged by this UI correction. The current screen exposes their linked data and dated price entries. Generic site-factor computation, route automation and quotation/BOQ calculations are not introduced.
