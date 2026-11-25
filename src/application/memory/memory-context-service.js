export function createMemoryContextService({ memoryRepository, sourceService, securityPolicyService = null, clock = null }) {
  const nowIso = () => (clock ? clock.nowIso() : new Date().toISOString());

  return {
    filterContext(records, {
      asOf = nowIso(),
      includeDisputed = false,
      minConfidence = null,
      allowedSensitivities = ['PUBLIC', 'INTERNAL', 'PERSONAL'],
      forAI = false,
    } = {}) {
      return records.filter(rec => {
        if (rec.status === 'RETIRED' || rec.status === 'ARCHIVED' || rec.status === 'SUPERSEDED') return false;
        if (rec.status === 'DISPUTED' && !includeDisputed) return false;
        if (rec.valid_from && rec.valid_from > asOf) return false;
        if (rec.valid_until && rec.valid_until < asOf) return false;
        if (minConfidence !== null && rec.confidence !== null && rec.confidence < minConfidence) return false;
        if (forAI && rec.sensitivity === 'RESTRICTED') return false;
        if (allowedSensitivities && !allowedSensitivities.includes(rec.sensitivity)) return false;
        if (forAI && securityPolicyService && rec.sensitivity === 'SENSITIVE') return false;
        return true;
      });
    },

    retrieveContext({ query = null, types = null, limit = 25, ...filterOptions } = {}) {
      const candidates = memoryRepository.searchMemory({ q: query, limit: Math.min(limit * 3, 300) });
      const byType = Array.isArray(types) && types.length > 0
        ? candidates.filter(r => types.includes(r.information_type))
        : candidates;
      const filtered = this.filterContext(byType, filterOptions).slice(0, limit);
      return filtered;
    },

    buildContext(options = {}) {
      const items = this.retrieveContext(options);
      const sources = this.getContextSources(items);
      return {
        generated_at: nowIso(),
        count: items.length,
        items,
        sources,
        policy_applied: {
          excludes_retired: true,
          excludes_archived: true,
          for_ai: Boolean(options.forAI),
        },
      };
    },

    getContextSources(items = []) {
      const uniqueIds = [...new Set(items.map(i => i.source_id).filter(Boolean))];
      return uniqueIds.map(id => {
        try { return sourceService.getSource(id); } catch { return { id, missing: true }; }
      });
    },
  };
}
