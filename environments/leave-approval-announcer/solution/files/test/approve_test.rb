# frozen_string_literal: true

require "minitest/autorun"
require "tmpdir"
require "fileutils"
require "json"
require_relative "../lib/leavedesk/requests"

class ApproveTest < Minitest::Test
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

  def test_approve_books_balance_and_announces
    Leavedesk::Requests.approve(@store, @chat, "LV-0144", by: "e-200", now: Time.utc(2026, 11, 16, 9, 30))
    saved = Leavedesk::Store.new(@store.dir)
    assert_equal "approved", saved.request("LV-0144")["status"]
    assert_equal "2026-11-16T09:30:00Z", saved.request("LV-0144")["decided_at"]
    assert_equal 14.0, saved.balance("e-202", "annual")
    card = posts("team-calendar").last["card"]
    assert_equal "Anouk de Vries is off Mon 7 Dec - Fri 11 Dec", card["title"]
    assert_equal ["Employee", "Team", "Dates", "Working days", "Cover"], card["fields"].map { |f| f["label"] }
    assert_equal "Your leave is approved", posts("dm-e-202").last["card"]["title"]
  end

  def test_announcement_leaves_out_the_reason
    Leavedesk::Requests.approve(@store, @chat, "LV-0142", by: "e-300", now: Time.utc(2026, 11, 16))
    refute_includes JSON.generate(posts("team-calendar")), "IVF"
  end

  def test_refusals
    assert_raises(Leavedesk::NotAllowed) { Leavedesk::Requests.approve(@store, @chat, "LV-0141", by: "e-200", now: Time.now) }
    assert_raises(Leavedesk::NotAllowed) { Leavedesk::Requests.approve(@store, @chat, "LV-0144", by: "e-203", now: Time.now) }
    @store.balances["e-202"]["annual"] = 2.0
    assert_raises(Leavedesk::PolicyError) { Leavedesk::Requests.approve(@store, @chat, "LV-0144", by: "e-200", now: Time.now) }
  end

  def test_chat_outage_keeps_the_approval
    ENV["CHAT_FAIL"] = "1"
    outcome = Leavedesk::Requests.approve(@store, @chat, "LV-0144", by: "e-200", now: Time.now)
    assert_equal ["chat is unavailable"], outcome[:warnings]
    assert_equal "approved", Leavedesk::Store.new(@store.dir).request("LV-0144")["status"]
  ensure
    ENV.delete("CHAT_FAIL")
  end
end
