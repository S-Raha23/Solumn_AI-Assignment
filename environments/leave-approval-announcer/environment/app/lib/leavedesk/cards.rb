# frozen_string_literal: true

require "date"

module Leavedesk
  # Builds the chat cards leavedesk posts. A card is
  #   { "title" => String, "fields" => [{ "label" => String, "value" => String }], "footer" => String }
  module Cards
    DEFAULT_FIELDS = %i[employee team type dates days reason cover balance].freeze

    LABELS = {
      employee: "Employee", team: "Team", type: "Leave type", dates: "Dates", days: "Working days",
      reason: "Reason", cover: "Cover", balance: "Balance after", status: "Status", approver: "Approved by"
    }.freeze

    module_function

    # "Mon 7 Dec" or "Mon 7 Dec - Fri 11 Dec", with "(pm)" / "(am)" on half days.
    def format_dates(request)
      first = Date.parse(request["first_day"])
      last = Date.parse(request["last_day"])
      start = first.strftime("%a %-d %b") + (request["half_start"] ? " (pm)" : "")
      finish = last.strftime("%a %-d %b") + (request["half_end"] ? " (am)" : "")
      first == last ? start : "#{start} - #{finish}"
    end

    def format_days(days)
      (days % 1).zero? ? days.to_i.to_s : days.to_s
    end

    def field_value(name, request, store)
      employee = store.employee(request["employee"])
      case name
      when :employee then employee["name"]
      when :team then employee["team"]
      when :type then request["type"].capitalize
      when :dates then format_dates(request)
      when :days then format_days(request["days"])
      when :reason then request["reason"].to_s.empty? ? "-" : request["reason"]
      when :cover then request["cover"] ? store.employee(request["cover"])["name"] : "None arranged"
      when :balance
        left = store.balance(request["employee"], request["type"])
        left.nil? ? "n/a" : format_days(left)
      when :status then request["status"].capitalize
      when :approver then request["decided_by"] ? store.employee(request["decided_by"])["name"] : "-"
      else raise ArgumentError, "unknown card field #{name}"
      end
    end

    # A card about one leave request.
    def leave_card(request, store, title:, fields: DEFAULT_FIELDS, footer: nil)
      {
        "title" => title,
        "fields" => fields.map { |f| { "label" => LABELS.fetch(f), "value" => field_value(f, request, store) } },
        "footer" => footer || "leavedesk #{request['id']}"
      }
    end
  end
end
