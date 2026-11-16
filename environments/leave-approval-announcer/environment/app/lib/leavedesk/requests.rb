# frozen_string_literal: true

require "date"
require "time"
require_relative "store"
require_relative "policy"
require_relative "cards"
require_relative "chat"

module Leavedesk
  class NotAllowed < StandardError; end

  # Submitting and deciding leave requests.
  module Requests
    module_function

    # Files a request and asks the employee's manager to decide it. The
    # manager gets the full card by direct message; #people-ops gets a copy.
    def submit(store, chat, employee_id:, type:, first_day:, last_day:, reason:, cover: nil,
               half_start: false, half_end: false, today:)
      employee = store.employee(employee_id)
      store.employee(cover) if cover
      first = Date.parse(first_day)
      last = Date.parse(last_day)
      days = Policy.check!(store, employee_id, type, first, last, today: today,
                                                                  half_start: half_start, half_end: half_end)
      request = {
        "id" => store.next_request_id, "employee" => employee_id, "type" => type,
        "first_day" => first.iso8601, "last_day" => last.iso8601, "half_start" => half_start,
        "half_end" => half_end, "days" => days, "reason" => reason.to_s.strip, "cover" => cover,
        "status" => "pending", "submitted_at" => today.iso8601
      }
      store.add_request(request)
      store.save
      card = Cards.leave_card(request, store, title: "Leave request from #{employee['name']}")
      manager = store.manager_of(employee_id)
      chat.direct(manager, card) if manager
      chat.post("people-ops", card)
      request
    end

    def ensure_decider!(store, request, by)
      decider = store.employee(by)
      return decider if store.manager_of(request["employee"])&.fetch("id") == by || store.people_team?(by)

      raise NotAllowed, "#{decider['name']} cannot decide #{request['id']}"
    end

    def ensure_pending!(request)
      return if request["status"] == "pending"

      raise NotAllowed, "#{request['id']} is already #{request['status']}"
    end

    # Declines a pending request and tells the employee.
    def decline(store, chat, request_id, by:, note:, now:)
      request = store.request(request_id)
      ensure_pending!(request)
      ensure_decider!(store, request, by)
      request.merge!("status" => "declined", "decided_by" => by, "decided_at" => now.utc.strftime("%Y-%m-%dT%H:%M:%SZ"),
                     "decision_note" => note.to_s.strip)
      store.save
      employee = store.employee(request["employee"])
      chat.direct(employee, Cards.leave_card(request, store, title: "Your leave request was declined",
                                                             fields: %i[type dates days status approver],
                                                             footer: request["decision_note"]))
      request
    end
  end
end
