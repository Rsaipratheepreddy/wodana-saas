# API contracts

Business Core owns the canonical OpenAPI contract. Typed frontend clients and Python command models will be generated here once the first domain module is introduced. Keeping generated contracts in one package prevents the web and worker services from inventing incompatible payloads.
