(function() {
  function text(value) {
    return (value === null || value === undefined) ? "" : String(value).trim();
  }

  function slugify(value) {
    return text(value).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  }

  function truthy(value) {
    return ["true", "yes", "y", "1"].indexOf(text(value).toLowerCase()) >= 0;
  }

  function asNumber(value) {
    const parsed = parseFloat(text(value) || "0");
    return isNaN(parsed) ? 0 : parsed;
  }

  function formatMoney(value) {
    const amount = asNumber(value);
    if (Math.abs(amount - Math.round(amount)) < 0.001) {
      return "$" + String(Math.round(amount));
    }
    return "$" + amount.toFixed(2);
  }

  function formatBlank(value) {
    return text(value) ? text(value) : "—";
  }

  function copyText(value) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(value);
    }
    return new Promise(function(resolve, reject) {
      try {
        const area = document.createElement("textarea");
        area.value = value;
        document.body.appendChild(area);
        area.select();
        document.execCommand("copy");
        document.body.removeChild(area);
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  }

  function downloadFile(filename, content, mimeType) {
    const blob = new Blob([content], { type: mimeType || "text/plain;charset=utf-8" });
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(function() { URL.revokeObjectURL(href); }, 500);
  }

  function readInlineJson(id) {
    const node = document.getElementById(id);
    if (!node) {
      return null;
    }
    try {
      return JSON.parse(node.textContent);
    } catch (error) {
      console.warn("Failed to parse inline Association JSON for", id, error);
      return null;
    }
  }

  function parseQueryState() {
    const params = new URLSearchParams(window.location.search);
    const keepers = text(params.get("keepers")).split(",").map(function(item) { return slugify(item); }).filter(Boolean);
    return {
      keepers: keepers,
      bird: slugify(params.get("bird")),
      taxAck: params.get("tax_ack") === "1",
      auctionAck: params.get("auction_ack") === "1"
    };
  }

  function updateUrl(state) {
    const params = new URLSearchParams(window.location.search);
    if (state.slots.filter(Boolean).length) {
      params.set("keepers", state.slots.filter(Boolean).join(","));
    } else {
      params.delete("keepers");
    }
    if (state.birdRightsSlug) {
      params.set("bird", state.birdRightsSlug);
    } else {
      params.delete("bird");
    }
    if (state.ackTax) {
      params.set("tax_ack", "1");
    } else {
      params.delete("tax_ack");
    }
    if (state.ackAuction) {
      params.set("auction_ack", "1");
    } else {
      params.delete("auction_ack");
    }
    const next = window.location.pathname + (params.toString() ? ("?" + params.toString()) : "");
    window.history.replaceState({}, "", next);
  }

  function buildInitialSlots(players, queryState) {
    const seen = {};
    const queryKeepers = (queryState.keepers || []).filter(function(slug) {
      return players.some(function(player) { return player.player_slug === slug; });
    });
    const selected = queryKeepers.length ? queryKeepers : players.filter(function(player) { return truthy(player.keeper_selected); }).map(function(player) { return player.player_slug; });
    const slots = new Array(12).fill("");
    selected.forEach(function(slug, index) {
      if (!seen[slug] && index < slots.length) {
        slots[index] = slug;
        seen[slug] = true;
      }
    });
    return slots;
  }

  function getSelectedPlayers(playersBySlug, slots) {
    return slots.filter(Boolean).map(function(slug) { return playersBySlug[slug]; }).filter(Boolean);
  }

  function evaluateScenario(config, playersBySlug, slots, birdRightsSlug, ackTax, ackAuction) {
    const selectedPlayers = getSelectedPlayers(playersBySlug, slots);
    const keeperCount = selectedPlayers.length;
    const nonRookieCount = selectedPlayers.filter(function(player) { return !truthy(player.rookie_flag); }).length;
    const projectedSalary = selectedPlayers.reduce(function(total, player) {
      return total + asNumber(player.approved_2026_salary || player.salary_2026);
    }, 0);
    const softCap = asNumber(config.soft_cap);
    const hardCap = asNumber(config.hard_cap);
    const taxRate = asNumber(config.luxury_tax_rate);
    const minKeepers = asNumber(config.min_keepers);
    const maxKeepers = asNumber(config.max_keepers);
    const minNonRookies = asNumber(config.min_non_rookie_keepers);
    const rosterSize = asNumber(config.roster_size);
    const overSoft = Math.max(projectedSalary - softCap, 0);
    const hardCapRoom = hardCap - projectedSalary;
    const softCapRoom = softCap - projectedSalary;
    const luxuryTaxEstimate = projectedSalary > softCap ? ((projectedSalary - softCap) * taxRate) : 0;
    const selectedBirdPlayers = selectedPlayers.filter(function(player) { return truthy(player.bird_rights_eligible); });
    const selectedBirdSlugs = selectedBirdPlayers.map(function(player) { return player.player_slug; });
    const issues = [];
    const warnings = [];
    let status = "valid";

    if (keeperCount < minKeepers) {
      status = "illegal";
      issues.push("Minimum 4 keepers required.");
    }
    if (keeperCount > maxKeepers) {
      status = "illegal";
      issues.push("Maximum 12 keepers allowed.");
    }
    if (nonRookieCount < minNonRookies) {
      status = "illegal";
      issues.push("Minimum 4 non-rookie keepers required.");
    }
    if (hardCapRoom < 0) {
      status = "illegal";
      issues.push("Team may never exceed the hard cap.");
    }

    let birdRightsUsed = false;
    if (projectedSalary > softCap) {
      birdRightsUsed = true;
      if (keeperCount !== rosterSize) {
        status = "illegal";
        issues.push("Over-soft-cap paths require keeping all 12 roster slots.");
      }
      if (!birdRightsSlug) {
        status = "illegal";
        issues.push("Declare a Bird Rights player to exceed the soft cap.");
      } else if (selectedBirdSlugs.indexOf(birdRightsSlug) === -1) {
        status = "illegal";
        issues.push("Declared Bird Rights player must be both eligible and selected as a keeper.");
      }
      if (!ackTax) {
        status = "illegal";
        issues.push("Luxury tax acknowledgement is required over the soft cap.");
      }
      if (!ackAuction) {
        status = "illegal";
        issues.push("Auction-forfeit acknowledgement is required over the soft cap.");
      }
      if (status !== "illegal") {
        status = "warning";
        warnings.push("Legal only through the full-roster Bird Rights path.");
      }
    } else if (birdRightsSlug) {
      warnings.push("Bird Rights declaration is not needed while under the soft cap.");
    }

    const auctionEligible = (keeperCount < rosterSize && status !== "illegal") ? "Yes" : "No";
    const legalityStatus = status === "valid" ? "Valid" : (status === "warning" ? "Warning" : "Illegal");
    const declaredBirdPlayer = birdRightsSlug ? playersBySlug[birdRightsSlug] : null;

    return {
      selectedPlayers: selectedPlayers,
      keeperCount: keeperCount,
      nonRookieCount: nonRookieCount,
      projectedSalary: projectedSalary,
      softCapRoom: softCapRoom,
      overSoft: overSoft,
      hardCapRoom: hardCapRoom,
      luxuryTaxEstimate: luxuryTaxEstimate,
      auctionEligible: auctionEligible,
      birdRightsUsed: birdRightsUsed ? "Yes" : "No",
      declaredBirdPlayer: declaredBirdPlayer,
      legalityStatus: legalityStatus,
      statusClass: status,
      warnings: warnings,
      issues: issues,
      valid: status !== "illegal"
    };
  }

  function buildScenarioSummary(team, evaluation) {
    const names = evaluation.selectedPlayers.map(function(player) {
      return player.player_name + " (" + formatMoney(player.approved_2026_salary || player.salary_2026) + ")";
    });
    return [
      team.team_name + " Keeper Scenario",
      "Keepers: " + (names.length ? names.join(", ") : "None selected"),
      "Total keeper salary: " + formatMoney(evaluation.projectedSalary),
      "Soft cap room: " + formatMoney(evaluation.softCapRoom),
      "Hard cap room: " + formatMoney(evaluation.hardCapRoom),
      "Luxury tax estimate: " + formatMoney(evaluation.luxuryTaxEstimate),
      "Bird Rights declaration: " + (evaluation.declaredBirdPlayer ? evaluation.declaredBirdPlayer.player_name : "None"),
      "Auction eligible: " + evaluation.auctionEligible,
      "Validation status: " + evaluation.legalityStatus,
      "Warnings: " + (evaluation.issues.concat(evaluation.warnings).join(" | ") || "None")
    ].join("\n");
  }

  function buildDiscordSummary(team, evaluation) {
    return [
      "**" + team.team_name + "** keeper scenario",
      "Keepers (" + evaluation.keeperCount + "): " + (evaluation.selectedPlayers.map(function(player) { return player.player_name + " " + formatMoney(player.approved_2026_salary || player.salary_2026); }).join(", ") || "None"),
      "Total salary: " + formatMoney(evaluation.projectedSalary),
      "Soft cap room: " + formatMoney(evaluation.softCapRoom),
      "Hard cap room: " + formatMoney(evaluation.hardCapRoom),
      "Luxury tax: " + formatMoney(evaluation.luxuryTaxEstimate),
      "Bird Rights: " + (evaluation.declaredBirdPlayer ? evaluation.declaredBirdPlayer.player_name : "None"),
      "Auction eligible: " + evaluation.auctionEligible,
      "Status: " + evaluation.legalityStatus,
      evaluation.issues.concat(evaluation.warnings).length ? ("Notes: " + evaluation.issues.concat(evaluation.warnings).join(" | ")) : ""
    ].filter(Boolean).join("\n");
  }

  function chooseCheapestNonRookies(players, count) {
    return players.filter(function(player) { return !truthy(player.rookie_flag); }).sort(function(a, b) {
      return asNumber(a.approved_2026_salary || a.salary_2026) - asNumber(b.approved_2026_salary || b.salary_2026);
    }).slice(0, count).map(function(player) { return player.player_slug; });
  }

  function chooseHighestSalaryNonRookies(players, count) {
    return players.filter(function(player) { return !truthy(player.rookie_flag); }).sort(function(a, b) {
      return asNumber(b.approved_2026_salary || b.salary_2026) - asNumber(a.approved_2026_salary || a.salary_2026);
    }).slice(0, count).map(function(player) { return player.player_slug; });
  }

  function setSlotsFromList(state, slugs) {
    state.slots = new Array(12).fill("");
    slugs.slice(0, 12).forEach(function(slug, index) {
      state.slots[index] = slug;
    });
  }

  function initSimulator(team, config) {
    const root = document.getElementById("association-simulator-root");
    if (!root || !team || !team.roster) {
      return;
    }
    const players = team.roster.slice();
    const playersBySlug = {};
    players.forEach(function(player) {
      playersBySlug[player.player_slug] = player;
    });

    const queryState = parseQueryState();
    const state = {
      slots: buildInitialSlots(players, queryState),
      birdRightsSlug: queryState.bird,
      ackTax: queryState.taxAck,
      ackAuction: queryState.auctionAck
    };

    root.innerHTML = [
      '<div class="simulator-layout">',
      '  <div class="simulator-main">',
      '    <div class="simulator-panel">',
      '      <h2>Keeper Scenario Builder</h2>',
      '      <p class="section-note">Toggle keepers, test 12-slot scenarios, and review cap legality in real time. Rookie keepers can be selected, but they do not count toward the required four non-rookie keepers.</p>',
      '      <div class="simulator-actions">',
      '        <button type="button" data-scenario-action="clear">Clear All</button>',
      '        <button type="button" data-scenario-action="cheapest">Cheapest Legal 4</button>',
      '        <button type="button" data-scenario-action="top-salary">Top Salary Core</button>',
      '        <button type="button" data-scenario-action="run-it-back">Run It Back</button>',
      '        <button type="button" data-scenario-action="auction-flex">Auction Flexibility</button>',
      '      </div>',
      '    </div>',
      '    <div class="simulator-panel">',
      '      <h3>Scenario Builder</h3>',
      '      <div class="scenario-grid" id="scenario-slot-grid"></div>',
      '    </div>',
      '    <div class="simulator-panel bird-rights-panel" id="bird-rights-panel">',
      '      <h3>Bird Rights Declaration</h3>',
      '      <div class="simulator-field"><label for="declared-bird-rights-player">Declared Bird Rights Player</label><select id="declared-bird-rights-player"></select></div>',
      '      <div class="acknowledgement-box" id="bird-rights-acknowledgements">',
      '        <label><input type="checkbox" id="ack-tax">I acknowledge luxury tax exposure.</label>',
      '        <label><input type="checkbox" id="ack-auction">I acknowledge that using Bird Rights requires keeping all 12 players and forfeiting the auction.</label>',
      '      </div>',
      '    </div>',
      '    <div class="simulator-panel">',
      '      <h3>Export Tools</h3>',
      '      <div class="simulator-export-actions">',
      '        <button type="button" id="copy-keeper-summary">Copy Keeper Summary</button>',
      '        <button type="button" id="download-keeper-csv">Download Keeper CSV</button>',
      '        <button type="button" id="copy-discord-summary">Copy Discord Summary</button>',
      '      </div>',
      '      <p class="small-note">Shareable URL updates automatically as you change keepers.</p>',
      '    </div>',
      '  </div>',
      '  <div class="simulator-sidebar">',
      '    <div class="summary-block">',
      '      <h3>Scenario Summary</h3>',
      '      <p><span id="legality-badge" class="status-badge">Loading</span></p>',
      '      <div class="summary-metrics" id="summary-metrics"></div>',
      '    </div>',
      '    <div class="summary-block">',
      '      <h3>Selected Keepers</h3>',
      '      <div id="selected-keepers-list" class="scenario-empty">No keepers selected yet.</div>',
      '    </div>',
      '    <div class="summary-block">',
      '      <h3>What To Fix</h3>',
      '      <ul id="scenario-issues" class="issues-list"></ul>',
      '    </div>',
      '  </div>',
      '</div>'
    ].join("");

    const summaryMetrics = document.getElementById("summary-metrics");
    const selectedKeepersList = document.getElementById("selected-keepers-list");
    const issuesList = document.getElementById("scenario-issues");
    const legalityBadge = document.getElementById("legality-badge");
    const scenarioGrid = document.getElementById("scenario-slot-grid");
    const birdRightsPanel = document.getElementById("bird-rights-panel");
    const birdRightsSelect = document.getElementById("declared-bird-rights-player");
    const ackTaxBox = document.getElementById("ack-tax");
    const ackAuctionBox = document.getElementById("ack-auction");
    const rosterCheckboxes = Array.prototype.slice.call(document.querySelectorAll(".keeper-checkbox"));

    function syncRosterCheckboxes() {
      const selected = {};
      state.slots.filter(Boolean).forEach(function(slug) { selected[slug] = true; });
      rosterCheckboxes.forEach(function(box) {
        const row = box.closest("tr");
        const slug = box.getAttribute("data-player-slug");
        box.checked = !!selected[slug];
        if (row) {
          row.classList.toggle("selected-player-row", !!selected[slug]);
        }
      });
    }

    function renderScenarioSlots() {
      scenarioGrid.innerHTML = "";
      for (let index = 0; index < 12; index += 1) {
        const wrapper = document.createElement("div");
        wrapper.className = "scenario-slot";
        const label = document.createElement("label");
        label.setAttribute("for", "scenario-slot-" + index);
        label.textContent = "Keeper Slot " + (index + 1);
        const select = document.createElement("select");
        select.id = "scenario-slot-" + index;
        select.setAttribute("data-slot-index", String(index));
        const emptyOption = document.createElement("option");
        emptyOption.value = "";
        emptyOption.textContent = "—";
        select.appendChild(emptyOption);
        const selectedElsewhere = {};
        state.slots.forEach(function(slug, slotIndex) {
          if (slotIndex !== index && slug) {
            selectedElsewhere[slug] = true;
          }
        });
        players.forEach(function(player) {
          const option = document.createElement("option");
          option.value = player.player_slug;
          option.textContent = player.player_name + " (" + formatMoney(player.approved_2026_salary || player.salary_2026) + ")";
          option.disabled = !!selectedElsewhere[player.player_slug];
          if (state.slots[index] === player.player_slug) {
            option.selected = true;
          }
          select.appendChild(option);
        });
        select.addEventListener("change", function(event) {
          const slotIndex = parseInt(event.target.getAttribute("data-slot-index"), 10);
          const nextSlug = slugify(event.target.value);
          if (nextSlug) {
            const duplicateIndex = state.slots.findIndex(function(value, currentIndex) {
              return currentIndex !== slotIndex && value === nextSlug;
            });
            if (duplicateIndex >= 0) {
              state.slots[duplicateIndex] = "";
            }
          }
          state.slots[slotIndex] = nextSlug;
          renderAll();
        });
        wrapper.appendChild(label);
        wrapper.appendChild(select);
        scenarioGrid.appendChild(wrapper);
      }
    }

    function renderBirdRights(evaluation) {
      const teamBirdPlayers = players.filter(function(player) { return truthy(player.bird_rights_eligible); });
      birdRightsSelect.innerHTML = "";
      const noneOption = document.createElement("option");
      noneOption.value = "";
      noneOption.textContent = "None";
      birdRightsSelect.appendChild(noneOption);
      teamBirdPlayers.forEach(function(player) {
        const option = document.createElement("option");
        option.value = player.player_slug;
        option.textContent = player.player_name + " (" + formatMoney(player.approved_2026_salary || player.salary_2026) + ")";
        if (state.birdRightsSlug === player.player_slug) {
          option.selected = true;
        }
        birdRightsSelect.appendChild(option);
      });
      if (state.birdRightsSlug && !teamBirdPlayers.some(function(player) { return player.player_slug === state.birdRightsSlug; })) {
        state.birdRightsSlug = "";
      }
      birdRightsPanel.classList.toggle("hidden", teamBirdPlayers.length === 0);
      document.getElementById("bird-rights-acknowledgements").classList.toggle("hidden", evaluation.overSoft <= 0);
      ackTaxBox.checked = !!state.ackTax;
      ackAuctionBox.checked = !!state.ackAuction;
    }

    function renderSummary(evaluation) {
      legalityBadge.className = "status-badge " + evaluation.statusClass;
      legalityBadge.textContent = evaluation.legalityStatus;
      const metrics = [
        ["Selected Keepers", String(evaluation.keeperCount), "Non-rookie: " + String(evaluation.nonRookieCount)],
        ["Projected Keeper Salary", formatMoney(evaluation.projectedSalary), ""],
        ["Soft Cap Room", formatMoney(evaluation.softCapRoom), evaluation.overSoft > 0 ? ("Over soft cap by " + formatMoney(evaluation.overSoft)) : "Under soft cap"],
        ["Hard Cap Room", formatMoney(evaluation.hardCapRoom), ""],
        ["Luxury Tax Estimate", formatMoney(evaluation.luxuryTaxEstimate), ""],
        ["Auction Eligible", evaluation.auctionEligible, "Bird Rights used: " + evaluation.birdRightsUsed]
      ];
      summaryMetrics.innerHTML = metrics.map(function(metric) {
        return [
          '<div class="summary-metric">',
          '  <div class="metric-label">' + metric[0] + '</div>',
          '  <div class="metric-value">' + metric[1] + '</div>',
          '  <div class="metric-detail">' + formatBlank(metric[2]) + '</div>',
          '</div>'
        ].join("");
      }).join("");
      if (evaluation.selectedPlayers.length) {
        selectedKeepersList.innerHTML = [
          '<table><thead><tr><th>Player</th><th>Salary</th><th>Type</th></tr></thead><tbody>',
          evaluation.selectedPlayers.map(function(player) {
            return '<tr><td>' + player.player_name + '</td><td>' + formatMoney(player.approved_2026_salary || player.salary_2026) + '</td><td>' + (truthy(player.rookie_flag) ? 'Rookie' : 'Non-rookie') + '</td></tr>';
          }).join(""),
          '</tbody></table>'
        ].join("");
      } else {
        selectedKeepersList.innerHTML = '<div class="scenario-empty">No keepers selected yet.</div>';
      }
      const issueItems = evaluation.issues.concat(evaluation.warnings);
      if (issueItems.length) {
        issuesList.innerHTML = issueItems.map(function(item) { return "<li>" + item + "</li>"; }).join("");
      } else {
        issuesList.innerHTML = "<li>Scenario is clean.</li>";
      }
    }

    function renderAll() {
      syncRosterCheckboxes();
      renderScenarioSlots();
      const evaluation = evaluateScenario(config, playersBySlug, state.slots, state.birdRightsSlug, state.ackTax, state.ackAuction);
      renderBirdRights(evaluation);
      renderSummary(evaluation);
      updateUrl(state);
    }

    rosterCheckboxes.forEach(function(box) {
      box.addEventListener("change", function(event) {
        const slug = slugify(event.target.getAttribute("data-player-slug"));
        const existingIndex = state.slots.indexOf(slug);
        if (event.target.checked) {
          if (existingIndex === -1) {
            const emptyIndex = state.slots.indexOf("");
            if (emptyIndex >= 0) {
              state.slots[emptyIndex] = slug;
            } else {
              event.target.checked = false;
              window.alert("All 12 keeper slots are already in use.");
              return;
            }
          }
        } else if (existingIndex >= 0) {
          state.slots[existingIndex] = "";
        }
        renderAll();
      });
    });

    birdRightsSelect.addEventListener("change", function(event) {
      state.birdRightsSlug = slugify(event.target.value);
      renderAll();
    });
    ackTaxBox.addEventListener("change", function(event) {
      state.ackTax = !!event.target.checked;
      renderAll();
    });
    ackAuctionBox.addEventListener("change", function(event) {
      state.ackAuction = !!event.target.checked;
      renderAll();
    });

    Array.prototype.slice.call(document.querySelectorAll("[data-scenario-action]")).forEach(function(button) {
      button.addEventListener("click", function() {
        const action = button.getAttribute("data-scenario-action");
        if (action === "clear") {
          setSlotsFromList(state, []);
          state.birdRightsSlug = "";
          state.ackTax = false;
          state.ackAuction = false;
        } else if (action === "cheapest" || action === "auction-flex") {
          setSlotsFromList(state, chooseCheapestNonRookies(players, asNumber(config.min_non_rookie_keepers || 4)));
          state.birdRightsSlug = "";
          state.ackTax = false;
          state.ackAuction = false;
        } else if (action === "top-salary") {
          setSlotsFromList(state, chooseHighestSalaryNonRookies(players, asNumber(config.min_non_rookie_keepers || 4)));
          state.birdRightsSlug = "";
          state.ackTax = false;
          state.ackAuction = false;
        } else if (action === "run-it-back") {
          setSlotsFromList(state, players.slice(0, asNumber(config.roster_size || 12)).map(function(player) { return player.player_slug; }));
        }
        renderAll();
      });
    });

    document.getElementById("copy-keeper-summary").addEventListener("click", function() {
      const evaluation = evaluateScenario(config, playersBySlug, state.slots, state.birdRightsSlug, state.ackTax, state.ackAuction);
      copyText(buildScenarioSummary(team, evaluation));
    });
    document.getElementById("copy-discord-summary").addEventListener("click", function() {
      const evaluation = evaluateScenario(config, playersBySlug, state.slots, state.birdRightsSlug, state.ackTax, state.ackAuction);
      copyText(buildDiscordSummary(team, evaluation));
    });
    document.getElementById("download-keeper-csv").addEventListener("click", function() {
      const evaluation = evaluateScenario(config, playersBySlug, state.slots, state.birdRightsSlug, state.ackTax, state.ackAuction);
      const lines = ["team_name,player_name,approved_2026_salary,rookie_flag,bird_rights_eligible"];
      evaluation.selectedPlayers.forEach(function(player) {
        lines.push([
          '"' + team.team_name.replace(/"/g, '""') + '"',
          '"' + player.player_name.replace(/"/g, '""') + '"',
          asNumber(player.approved_2026_salary || player.salary_2026),
          truthy(player.rookie_flag) ? "true" : "false",
          truthy(player.bird_rights_eligible) ? "true" : "false"
        ].join(","));
      });
      downloadFile(slugify(team.team_id || team.team_name) + "_keeper_scenario.csv", lines.join("\n"), "text/csv;charset=utf-8");
    });

    renderAll();
  }

  document.addEventListener("DOMContentLoaded", function() {
    const root = document.getElementById("association-simulator-root");
    if (!root) {
      return;
    }
    const inlineTeam = readInlineJson("association-team-roster-data");
    const inlineConfig = readInlineJson("association-cap-config-data");
    if (inlineTeam && inlineConfig) {
      initSimulator(inlineTeam, inlineConfig);
    }
  });
})();
