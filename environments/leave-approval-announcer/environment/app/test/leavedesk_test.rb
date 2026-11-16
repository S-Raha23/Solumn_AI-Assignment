# frozen_string_literal: true

require "minitest/autorun"
require "tmpdir"
require "fileutils"
require "json"
require_relative "../lib/leavedesk/requests"

class LeavedeskTest < Minitest::Test
  DATA = File.expand_path("../data", __dir__)

  def setup
    @tmp = Dir.mktmpdir("leavedesk")
    FileUtils.cp_r(DATA, File.join(@tmp, "data"))
    @store = Leavedesk::Store.new(File.join(@tmp, "data"))
    @outbox = File.join(@tmp, "outbox")
    @chat = Leavedesk::Chat.new(root: @outbox, now: -> { Time.utc(2026, 11, 16, 9, 0) })
  end

  def teardown
    FileUtils.rm_rf(@tmp)
  end

  def posts(box)
    Dir.glob(File.join(@outbox, box, "*.json")).sort.map { |f| JSON.parse(File.read(f)) }
  end

  def test_working_days_skip_weekends_and_holidays
    hols = Leavedesk::Policy.holidays(@store.dir)
    assert_equal 2.0, Leavedesk::Policy.working_days(Date.new(2026, 12, 24), Date.new(2026, 12, 29), hols)
    assert_equal 4.5, Leavedesk::Policy.working_days(Date.new(2026, 12, 7), Date.new(2026, 12, 11), hols, half_end: true)
    assert_equal 0.5, Leavedesk::Policy.working_days(Date.new(2026, 12, 7), Date.new(2026, 12, 7), hols,
                                                     half_start: true, half_end: true)
  end

  def test_format_dates
    request = { "first_day" => "2026-12-21", "last_day" => "2026-12-24", "half_end" => true }
    assert_equal "Mon 21 Dec - Thu 24 Dec (am)", Leavedesk::Cards.format_dates(request)
  end

  def test_submit_asks_manager_and_people_ops
    r = Leavedesk::Requests.submit(@store, @chat, employee_id: "e-202", type: "annual", first_day: "2027-01-04",
                                                  last_day: "2027-01-08", reason: "Skiing", cover: "e-203",
                                                  today: Date.new(2026, 11, 16))
    assert_equal "LV-0146", r["id"]
    assert_equal 5.0, r["days"]
    dm = posts("dm-e-200").last
    assert_equal "Leave request from Anouk de Vries", dm["card"]["title"]
    assert_includes dm["card"]["fields"], { "label" => "Reason", "value" => "Skiing" }
    assert_equal 1, posts("people-ops").size
  end

  def test_policy_rejections
    assert_raises(Leavedesk::PolicyError) do
      Leavedesk::Requests.submit(@store, @chat, employee_id: "e-202", type: "annual", first_day: "2026-11-20",
                                                last_day: "2026-11-20", reason: "", today: Date.new(2026, 11, 16))
    end
    assert_raises(Leavedesk::PolicyError) do
      Leavedesk::Requests.submit(@store, @chat, employee_id: "e-202", type: "annual", first_day: "2026-12-09",
                                                last_day: "2026-12-10", reason: "", today: Date.new(2026, 11, 16))
    end
  end

  def test_decline_tells_employee
    Leavedesk::Requests.decline(@store, @chat, "LV-0144", by: "e-200", note: "Release week", now: Time.utc(2026, 11, 16))
    assert_equal "declined", Leavedesk::Store.new(@store.dir).request("LV-0144")["status"]
    card = posts("dm-e-202").last["card"]
    assert_equal "Release week", card["footer"]
    refute(card["fields"].any? { |f| f["label"] == "Reason" })
  end

  def test_only_manager_or_people_team_decide
    assert_raises(Leavedesk::NotAllowed) do
      Leavedesk::Requests.decline(@store, @chat, "LV-0144", by: "e-203", note: "", now: Time.now)
    end
    Leavedesk::Requests.decline(@store, @chat, "LV-0144", by: "e-101", note: "", now: Time.now)
  end
end
