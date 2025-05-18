// popup.js - Perbaikan untuk masalah pagination
document.addEventListener("DOMContentLoaded", function () {
  // Set tanggal hari ini sebagai default
  const today = new Date();
  const formattedDate = today.toISOString().split("T")[0];
  document.getElementById("tanggal").value = formattedDate;

  document
    .getElementById("scrapeButton")
    .addEventListener("click", function () {
      const tanggal = document.getElementById("tanggal").value;
      if (!tanggal) {
        showStatus("Silakan pilih tanggal terlebih dahulu!", "error");
        return;
      }

      showStatus("Memproses... Mohon tunggu", "info");
      const baseUrl = `http://apps.rsudntb.id/radiologi/pasien?jenis_cari=norm&katakunci=&ruanganAsal=0&status=0&dpjp=0&expertise=0&daterange=${tanggal}+-+${tanggal}&filter=true`;

      chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        const currentTabId = tabs[0].id;

        // Selalu redirect ke halaman dengan tanggal yang benar terlebih dahulu
        chrome.tabs.update(currentTabId, { url: baseUrl }, function () {
          chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
            if (tabId === currentTabId && info.status === "complete") {
              chrome.tabs.onUpdated.removeListener(listener);

              // Mulai proses scraping setelah halaman pertama dimuat
              setTimeout(function () {
                // Kumpulkan data dari semua halaman
                collectAllPagesData(currentTabId, tanggal, baseUrl);
              }, 2000);
            }
          });
        });
      });
    });

  // Fungsi untuk mengumpulkan data dari semua halaman
  function collectAllPagesData(tabId, tanggal, baseUrl) {
    // Jalankan script untuk mendeteksi jumlah halaman dan mengambil data halaman pertama
    chrome.scripting.executeScript(
      {
        target: { tabId: tabId },
        function: getFirstPageAndPaginationInfo,
      },
      function (results) {
        if (chrome.runtime.lastError) {
          showStatus("Error: " + chrome.runtime.lastError.message, "error");
          return;
        }

        if (results && results[0] && results[0].result) {
          const pageInfo = results[0].result;

          if (!pageInfo.success) {
            showStatus(pageInfo.message, "error");
            return;
          }

          // Data total yang akan dikumpulkan
          let allData = [...pageInfo.firstPageData];

          // Jika hanya ada satu halaman, langsung proses hasilnya
          if (pageInfo.totalPages <= 1) {
            formatAndDownloadData(allData, tanggal);
            return;
          }

          showStatus(
            `Mengumpulkan data dari ${pageInfo.totalPages} halaman...`,
            "info"
          );

          // Fungsi untuk mengumpulkan data dari halaman berikutnya secara rekursif
          function getNextPageData(currentPage) {
            // Jika sudah semua halaman diproses, format dan download hasilnya
            if (currentPage > pageInfo.totalPages) {
              // Kembali ke halaman awal
              chrome.tabs.update(tabId, { url: baseUrl }, function () {
                setTimeout(() => {
                  formatAndDownloadData(allData, tanggal);
                }, 1000);
              });
              return;
            }

            // Update status
            showStatus(
              `Mengumpulkan halaman ${currentPage} dari ${pageInfo.totalPages}...`,
              "info"
            );

            // Buka halaman berikutnya
            const nextPageUrl = `${baseUrl}&page=${currentPage}`;
            chrome.tabs.update(tabId, { url: nextPageUrl }, function () {
              // Tunggu sampai halaman dimuat
              function checkUrlLoaded() {
                chrome.tabs.get(tabId, function (tab) {
                  // Cek apakah halaman sudah dimuat dengan URL yang benar
                  if (
                    tab.status === "complete" &&
                    tab.url.includes(`page=${currentPage}`)
                  ) {
                    // Halaman sudah dimuat, ambil datanya
                    setTimeout(() => {
                      chrome.scripting.executeScript(
                        {
                          target: { tabId: tabId },
                          function: getPageData,
                        },
                        function (pageResults) {
                          if (
                            pageResults &&
                            pageResults[0] &&
                            pageResults[0].result
                          ) {
                            // Tambahkan data dari halaman ini
                            allData = [...allData, ...pageResults[0].result];

                            // Lanjut ke halaman berikutnya
                            setTimeout(() => {
                              getNextPageData(currentPage + 1);
                            }, 500);
                          } else {
                            // Lanjut ke halaman berikutnya meskipun error
                            console.error(
                              "Error mengambil data dari halaman " + currentPage
                            );
                            setTimeout(() => {
                              getNextPageData(currentPage + 1);
                            }, 500);
                          }
                        }
                      );
                    }, 1500);
                  } else {
                    // Cek lagi setelah beberapa saat
                    setTimeout(checkUrlLoaded, 500);
                  }
                });
              }

              // Mulai cek loading halaman
              setTimeout(checkUrlLoaded, 1000);
            });
          }

          // Mulai dari halaman 2 (halaman 1 sudah diambil datanya)
          getNextPageData(2);
        } else {
          showStatus("Gagal memuat data halaman pertama", "error");
        }
      }
    );
  }

  // Fungsi untuk memformat dan mengunduh data
  function formatAndDownloadData(data, tanggal) {
    if (!data || data.length === 0) {
      showStatus(
        'Tidak ditemukan data dengan tujuan "Radiologi IGD Terpadu"',
        "error"
      );
      return;
    }

    // Urutkan data berdasarkan waktu
    data.sort((a, b) => a.waktu.localeCompare(b.waktu));

    // Format output
    let output = "";
    data.forEach((item, index) => {
      const paddedIndex = String(index + 1).padStart(2, "0");
      output += `PASIEN ${paddedIndex}\n`;
      output += `${item.waktu}\n`;
      output += `${item.noRM}\n`;
      output += `${item.nama}\n`;
      output += `${item.noPelayanan}\n`;
      output += `http://apps.rsudntb.id/radiologi/order/${item.noPelayanan}/detail\n\n`;
    });

    // Download hasil
    const blob = new Blob([output], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `radiologi_igd_terpadu_${tanggal}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showStatus(`Berhasil mengekstrak ${data.length} data!`, "success");
  }

  // Fungsi untuk menampilkan status
  function showStatus(message, type) {
    const statusElement = document.getElementById("status");
    statusElement.textContent = message;

    if (type === "error") {
      statusElement.style.backgroundColor = "#f8d7da";
      statusElement.style.color = "#721c24";
    } else if (type === "success") {
      statusElement.style.backgroundColor = "#d4edda";
      statusElement.style.color = "#155724";
    } else {
      statusElement.style.backgroundColor = "#f8f9fa";
      statusElement.style.color = "#000";
    }
  }
});

// Fungsi untuk mendapatkan data halaman pertama dan info pagination
function getFirstPageAndPaginationInfo() {
  try {
    // Verifikasi halaman
    if (!window.location.href.includes("apps.rsudntb.id/radiologi/pasien")) {
      return {
        success: false,
        message:
          "Halaman yang salah. Buka halaman Radiologi Pasien terlebih dahulu.",
      };
    }

    // Deteksi jumlah halaman dari pagination
    let totalPages = 1;
    const paginationLinks = document.querySelectorAll(".pagination li a");
    paginationLinks.forEach((link) => {
      const pageNum = parseInt(link.textContent);
      if (!isNaN(pageNum) && pageNum > totalPages) {
        totalPages = pageNum;
      }
    });

    // Ambil data halaman pertama
    const rows = document.querySelectorAll("#tindakan-table tbody tr");
    const firstPageData = [];

    rows.forEach((row) => {
      const tujuanCell = row.querySelector("td:nth-child(3)");
      const tujuanText = tujuanCell ? tujuanCell.textContent.trim() : "";

      if (tujuanText === "Radiologi IGD Terpadu") {
        firstPageData.push({
          waktu: row.querySelector("td:nth-child(2)").textContent.trim(),
          noRM: row.querySelector("td:nth-child(4)").textContent.trim(),
          nama: row.querySelector("td:nth-child(5)").textContent.trim(),
          noPelayanan: row.querySelector("td:nth-child(7)").textContent.trim(),
        });
      }
    });

    return {
      success: true,
      totalPages: totalPages,
      firstPageData: firstPageData,
    };
  } catch (error) {
    return {
      success: false,
      message: `Error: ${error.message}`,
    };
  }
}

// Fungsi untuk mengambil data dari halaman saat ini
function getPageData() {
  try {
    const rows = document.querySelectorAll("#tindakan-table tbody tr");
    const pageData = [];

    rows.forEach((row) => {
      const tujuanCell = row.querySelector("td:nth-child(3)");
      const tujuanText = tujuanCell ? tujuanCell.textContent.trim() : "";

      if (tujuanText === "Radiologi IGD Terpadu") {
        pageData.push({
          waktu: row.querySelector("td:nth-child(2)").textContent.trim(),
          noRM: row.querySelector("td:nth-child(4)").textContent.trim(),
          nama: row.querySelector("td:nth-child(5)").textContent.trim(),
          noPelayanan: row.querySelector("td:nth-child(7)").textContent.trim(),
        });
      }
    });

    return pageData;
  } catch (error) {
    console.error("Error pada fungsi getPageData:", error);
    return [];
  }
}
