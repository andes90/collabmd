class Collabmd < Formula
  desc "Collaborative markdown vault server"
  homepage "https://github.com/andes90/collabmd"
  url "https://github.com/andes90/collabmd/archive/refs/tags/v0.1.1.tar.gz"
  sha256 "RELEASE_WORKFLOW_WRITES_REAL_SHA256"
  license "MIT"

  depends_on "node"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink libexec/"bin/collabmd"
  end

  test do
    require "timeout"

    (testpath/"vault").mkpath
    (testpath/"vault/test.md").write("# Hello from Homebrew\n")

    port = free_port
    log_path = testpath/"collabmd.log"
    pid = spawn(
      bin/"collabmd",
      testpath/"vault",
      "--no-tunnel",
      "--host", "127.0.0.1",
      "--port", port.to_s,
      out: log_path,
      err: log_path
    )

    output = nil

    Timeout.timeout(15) do
      loop do
        begin
          output = shell_output("curl -fsS http://127.0.0.1:#{port}/health").strip
          break if output == "ok"
        rescue ErrorDuringExecution
          sleep 1
        else
          sleep 1 if output != "ok"
        end
      end
    end

    assert_equal "ok", output
  ensure
    begin
      Process.kill("TERM", pid)
    rescue Errno::ESRCH
      nil
    end

    begin
      Process.wait(pid)
    rescue Errno::ECHILD
      nil
    end
  end
end
