# frozen_string_literal: true

require "json"
require "yaml"
require "date"

module Leavedesk
  class NotFound < StandardError; end

  # Employees, leave requests and balances, read from $LEAVEDESK_DATA.
  class Store
    attr_reader :dir, :employees, :requests, :balances

    def self.default_dir
      ENV.fetch("LEAVEDESK_DATA", File.expand_path("../../data", __dir__))
    end

    def initialize(dir = self.class.default_dir)
      @dir = dir
      @employees = YAML.safe_load_file(File.join(dir, "employees.yml")).to_h { |e| [e["id"], e] }
      @requests = JSON.parse(File.read(File.join(dir, "requests.json"))).to_h { |r| [r["id"], r] }
      @balances = JSON.parse(File.read(File.join(dir, "balances.json")))
    end

    def employee(id)
      @employees.fetch(id) { raise NotFound, "no such employee: #{id}" }
    end

    def request(id)
      @requests.fetch(id) { raise NotFound, "no such request: #{id}" }
    end

    def manager_of(employee_id)
      manager_id = employee(employee_id)["manager"]
      manager_id && employee(manager_id)
    end

    def people_team?(employee_id)
      employee(employee_id)["team"] == "People"
    end

    # Remaining days of a leave type for an employee, or nil for types
    # without an allowance.
    def balance(employee_id, type)
      @balances.dig(employee_id, type)
    end

    def adjust_balance(employee_id, type, delta)
      current = balance(employee_id, type)
      return if current.nil?

      @balances[employee_id][type] = (current + delta).round(1)
    end

    def next_request_id
      highest = @requests.keys.map { |id| id.delete_prefix("LV-").to_i }.max || 0
      format("LV-%04d", highest + 1)
    end

    def add_request(request)
      @requests[request["id"]] = request
    end

    def save
      write("requests.json", @requests.values.sort_by { |r| r["id"] })
      write("balances.json", @balances)
    end

    private

    def write(name, value)
      path = File.join(@dir, name)
      File.write("#{path}.tmp", JSON.pretty_generate(value) + "\n")
      File.rename("#{path}.tmp", path)
    end
  end
end
