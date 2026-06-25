function normalizeValue(value) {
  return (value || "").toString().trim().toLowerCase();
}

function applyFilters() {
  document.querySelectorAll("[data-filter-group]").forEach(function(group) {
    const scopeId = group.getAttribute("data-filter-group");
    const filters = {};
    document.querySelectorAll('[data-filter-scope="' + scopeId + '"]').forEach(function(control) {
      filters[control.getAttribute("data-filter-key")] = normalizeValue(control.value);
    });
    document.querySelectorAll('[data-filter-target="' + scopeId + '"]').forEach(function(target) {
      let visible = true;
      Object.keys(filters).forEach(function(key) {
        const wanted = filters[key];
        if (!wanted) {
          return;
        }
        const actual = normalizeValue(target.getAttribute('data-' + key));
        if (actual !== wanted) {
          visible = false;
        }
      });
      target.style.display = visible ? "" : "none";
    });
  });
}

document.addEventListener("DOMContentLoaded", function() {
  document.querySelectorAll("[data-filter-scope]").forEach(function(control) {
    control.addEventListener("change", applyFilters);
  });
  applyFilters();
});
