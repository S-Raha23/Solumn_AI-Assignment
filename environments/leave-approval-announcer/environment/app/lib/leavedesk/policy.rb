# frozen_string_literal: true

require "date"
require "yaml"

module Leavedesk
  class PolicyError < StandardError; end

  # Leave types and how many working days a request uses.
  module Policy
    TYPES = {
      "annual" => { allowance: true, notice_days: 14 },
      "medical" => { allowance: false, notice_days: 0 },
      "compassionate" => { allowance: false, notice_days: 0 },
      "parental" => { allowance: true, notice_days: 28 },
      "unpaid" => { allowance: false, notice_days: 14 }
    }.freeze

    module_function

    def holidays(dir)
      YAML.safe_load_file(File.join(dir, "holidays.yml"), permitted_classes: [Date]).map { |d| Date.parse(d.to_s) }
    end

    # Working days from first to last (inclusive), skipping weekends and bank
    # holidays. A half day at either end counts 0.5.
    def working_days(first, last, holidays, half_start: false, half_end: false)
      raise PolicyError, "leave ends before it starts" if last < first

      days = (first..last).count { |d| !d.saturday? && !d.sunday? && !holidays.include?(d) }
      days -= 0.5 if half_start && working?(first, holidays)
      days -= 0.5 if half_end && working?(last, holidays) && (last != first || !half_start)
      days.to_f
    end

    def working?(day, holidays)
      !day.saturday? && !day.sunday? && !holidays.include?(day)
    end

    # Checks a new request against the leave rules. Returns the working days.
    def check!(store, employee_id, type, first, last, today:, half_start: false, half_end: false)
      rule = TYPES.fetch(type) { raise PolicyError, "unknown leave type: #{type}" }
      days = working_days(first, last, holidays(store.dir), half_start: half_start, half_end: half_end)
      raise PolicyError, "request covers no working days" if days.zero?
      if (first - today).to_i < rule[:notice_days]
        raise PolicyError, "#{type} leave needs #{rule[:notice_days]} days' notice"
      end
      if rule[:allowance]
        left = store.balance(employee_id, type).to_f
        raise PolicyError, "not enough #{type} leave: #{days} requested, #{left} left" if days > left
      end
      overlapping = store.requests.values.find do |r|
        r["employee"] == employee_id && %w[pending approved].include?(r["status"]) &&
          Date.parse(r["first_day"]) <= last && Date.parse(r["last_day"]) >= first
      end
      raise PolicyError, "overlaps #{overlapping['id']}" if overlapping

      days
    end
  end
end
