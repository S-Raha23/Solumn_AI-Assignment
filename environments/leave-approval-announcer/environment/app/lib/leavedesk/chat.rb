# frozen_string_literal: true

require "json"
require "yaml"
require "fileutils"

module Leavedesk
  class ChatError < StandardError; end

  # Posts cards to channels and direct messages on the company chat.
  #
  # There is no network in this image: every post is written, exactly as it
  # would be sent, to $CHAT_OUTBOX/<channel or dm-employee id>/NNNNN.json
  # (default /var/tmp/chat-outbox).
  class Chat
    def self.channels(dir = File.expand_path("../../config", __dir__))
      YAML.safe_load_file(File.join(dir, "channels.yml"))
    end

    def initialize(root: ENV.fetch("CHAT_OUTBOX", "/var/tmp/chat-outbox"), now: -> { Time.now.utc })
      @root = root
      @now = now
    end

    def post(channel, card)
      raise ChatError, "unknown channel ##{channel}" unless self.class.channels.key?(channel)

      deliver(channel, { "channel" => "##{channel}", "card" => card })
    end

    def direct(employee, card)
      deliver("dm-#{employee['id']}", { "to" => employee["chat_handle"], "card" => card })
    end

    private

    def deliver(box, message)
      raise ChatError, "chat is unavailable" if ENV.fetch("CHAT_FAIL", "") == "1"

      dir = File.join(@root, box)
      FileUtils.mkdir_p(dir)
      seq = Dir.children(dir).size + 1
      record = message.merge("posted_at" => @now.call.strftime("%Y-%m-%dT%H:%M:%SZ"))
      File.write(File.join(dir, format("%05d.json", seq)), JSON.pretty_generate(record) + "\n")
    end
  end
end
